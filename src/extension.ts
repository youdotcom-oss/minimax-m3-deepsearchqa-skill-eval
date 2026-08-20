/** You.com MCP bridge for Pi, registering dash-cased `you-search` and `you-contents`. */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { Type, type TSchema } from "typebox";

const MCP_URL = "https://api.you.com/mcp?tools=you-search,you-contents";
const CLIENT_INFO = { name: "minimax-m3-deepsearchqa-skill-eval", version: "0.0.0" } as const;
const ANY_OBJECT = Type.Object({}, { additionalProperties: true });
const TOOL_NAMES = new Set(["you-search", "you-contents"]);

interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

let sharedClient: Client | undefined;
let sharedClientPromise: Promise<Client> | undefined;
let discoveredTools: DiscoveredTool[] | undefined;

function createHeaders(): Record<string, string> {
  if (!process.env.YDC_API_KEY) throw new Error("YDC_API_KEY is required to call the You.com MCP server");
  return { Authorization: `Bearer ${process.env.YDC_API_KEY}` };
}

async function getSharedClient(): Promise<Client> {
  if (sharedClient) return sharedClient;
  sharedClientPromise ??= (async () => {
    const client = new Client(CLIENT_INFO);
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: createHeaders() },
    });
    await client.connect(transport);
    sharedClient = client;
    return client;
  })();
  return sharedClientPromise;
}

async function discoverTools(): Promise<DiscoveredTool[]> {
  if (discoveredTools) return discoveredTools;
  const client = await getSharedClient();
  const result = await client.listTools();
  discoveredTools = result.tools
    .filter((tool) => TOOL_NAMES.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
    }));
  return discoveredTools;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getSharedClient();
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

async function closeSharedClient(): Promise<void> {
  const client = sharedClient;
  sharedClient = undefined;
  sharedClientPromise = undefined;
  discoveredTools = undefined;
  if (!client) return;
  try {
    await client.close();
  } catch {
    // best effort
  }
}

function isTextBlock(block: unknown): block is { type: "text"; text: string } {
  return typeof block === "object" && block !== null && (block as { type?: string }).type === "text";
}

function toToolResult(result: CallToolResult): { content: { type: "text"; text: string }[]; details: unknown } {
  const content = (result.content ?? []).filter(isTextBlock).map((block) => ({ type: "text" as const, text: block.text }));
  return { content, details: (result.structuredContent ?? {}) as unknown };
}

function buildToolDefinition(tool: DiscoveredTool): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description ?? `Call ${tool.name} on the You.com MCP server.`,
    parameters: (tool.inputSchema ?? ANY_OBJECT) as unknown as TSchema,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("You.com MCP call was cancelled");
      try {
        const result = await callTool(tool.name, params as Record<string, unknown>);
        const adapted = toToolResult(result);
        if (!result.isError) return adapted;
        const errorText = adapted.content.length ? adapted.content.map((block) => block.text).join("\n") : `${tool.name} reported an error`;
        return { content: [{ type: "text", text: `Error: ${errorText}` }], details: { error: true } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Error calling You.com MCP tool "${tool.name}": ${message}` }], details: { error: message } };
      }
    },
  };
}

export default async function youToolsExtension(pi: ExtensionAPI): Promise<void> {
  const tools = await discoverTools();
  for (const tool of tools) pi.registerTool(buildToolDefinition(tool));
  pi.on("session_shutdown", () => {
    void closeSharedClient();
  });
}
