import { readStdin, writeStdout, type JsonObject } from "./io.ts";
import { collectFinalMessage, createPiSession, summarizeUsage } from "./pi-session.ts";

interface AdapterInput {
  task: { prompts: string[] };
  cwd: string;
  config?: JsonObject;
}

interface TrajectoryEvent extends Record<string, unknown> {
  type: "message" | "tool_call" | "error";
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const HARNESS_MESSAGE_ROLES = new Set(["user", "assistant", "system", "tool"]);
const SYSTEM_PROMPT =
  "You are an autonomous research agent. Answer the user's question using the available tools. " +
  "Ground factual claims in sources, include inline citations, and list sources at the end. Do not ask clarifying questions.";

if (import.meta.main) {
  const input = (await readStdin()) as AdapterInput;
  writeStdout(await runAdapter(input));
}

async function runAdapter(input: AdapterInput): Promise<object> {
  const model = String(input.config?.model ?? "minimax/minimax-m3");
  const provider = String(input.config?.provider ?? "openrouter");
  const thinkingLevel = readThinkingLevel(input.config?.thinkingLevel);
  const skillPath = String(input.config?.skillPath ?? new URL("../skills/you-web/SKILL.md", import.meta.url).pathname);
  const extensionPath = new URL("./extension.ts", import.meta.url).pathname;
  const prompt = input.task.prompts.join("\n\n");
  const { events, subscribe } = createTrajectoryCollector();

  const { session } = await createPiSession({
    model,
    provider,
    thinkingLevel,
    tools: ["you-search", "you-contents"],
    systemPrompt: SYSTEM_PROMPT,
    skillPath,
    extensionPath,
    cwd: input.cwd,
  });

  session.subscribe(subscribe);
  try {
    await session.prompt(prompt);
    const message = collectFinalMessage(session);
    if (!message) {
      return {
        result: {
          status: "failed",
          message: "No final assistant response generated.",
          error: "No final assistant response generated.",
          failureKind: "harness_error",
        },
        trajectory: events,
        metadata: { model, provider, thinkingLevel, usage: summarizeUsage(session.messages) },
      };
    }
    return {
      result: { status: "completed", message },
      trajectory: events,
      metadata: { model, provider, thinkingLevel, usage: summarizeUsage(session.messages) },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      result: { status: "failed", message: `Adapter error: ${message}`, error: message, failureKind: "harness_error" },
      trajectory: events,
      metadata: { model, provider, thinkingLevel },
    };
  } finally {
    session.dispose();
  }
}

function readThinkingLevel(value: unknown): ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.has(value) ? (value as ThinkingLevel) : "medium";
}

function createTrajectoryCollector(): { events: TrajectoryEvent[]; subscribe: (event: unknown) => void } {
  const events: TrajectoryEvent[] = [];
  const toolStartedAt = new Map<string, number>();

  function subscribe(event: unknown): void {
    const piEvent = event as { type?: string; [key: string]: unknown };
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    switch (piEvent.type) {
      case "tool_execution_start": {
        const toolCallId = String(piEvent.toolCallId ?? "");
        if (toolCallId) toolStartedAt.set(toolCallId, now);
        events.push({ type: "tool_call", name: String(piEvent.toolName ?? ""), status: "started", timestamp, input: asObject(piEvent.input ?? piEvent.args), metadata: toolCallId ? { toolCallId } : undefined });
        break;
      }
      case "tool_execution_end": {
        const toolCallId = String(piEvent.toolCallId ?? "");
        const startedAt = toolStartedAt.get(toolCallId);
        if (toolCallId) toolStartedAt.delete(toolCallId);
        events.push({ type: "tool_call", name: String(piEvent.toolName ?? ""), status: piEvent.isError ? "failed" : "completed", timestamp, durationMs: numberValue(piEvent.durationMs) ?? (startedAt === undefined ? undefined : now - startedAt), output: asObject(piEvent.result), metadata: toolCallId ? { toolCallId } : undefined });
        break;
      }
      case "message_end": {
        const message = asObject(piEvent.message);
        events.push({ type: "message", role: roleFrom(message) ?? "assistant", content: messageContent(message), timestamp, metadata: messageMetadata(message) });
        break;
      }
      case "error":
        events.push({ type: "error", message: String(piEvent.message ?? "Unknown error"), timestamp });
        break;
    }
  }

  return { events, subscribe };
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function roleFrom(message: JsonObject | undefined): string | undefined {
  const role = message?.role;
  return normalizeMessageRole(role);
}

export function normalizeMessageRole(role: unknown): "user" | "assistant" | "system" | "tool" | undefined {
  if (role === "toolResult") return "tool";
  return typeof role === "string" && HARNESS_MESSAGE_ROLES.has(role) ? (role as "user" | "assistant" | "system" | "tool") : undefined;
}

function messageContent(message: JsonObject | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part === "string" ? part : typeof (part as { text?: unknown })?.text === "string" ? (part as { text: string }).text : "")).join("");
}

function messageMetadata(message: JsonObject | undefined): JsonObject | undefined {
  if (!message) return undefined;
  const metadata: JsonObject = {};
  for (const key of ["api", "provider", "model", "responseModel", "responseId", "stopReason"]) {
    const value = message[key];
    if (typeof value === "string") metadata[key] = value;
  }
  if (message.usage !== undefined) metadata.usage = message.usage;
  return Object.keys(metadata).length ? metadata : undefined;
}
