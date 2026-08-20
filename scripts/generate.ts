import { dirname } from "node:path";
import { appendFileContents, ensureDir, readJsonl, removeIfExists, runCommandToFile, writeJsonl } from "../src/io.ts";
import { isForce, readIntegerEnv, readStringEnv } from "../src/env.ts";

const PROMPTS_PATH = readStringEnv("PROMPTS_PATH", "data/prompts.jsonl");
const TRAJECTORIES_PATH = readStringEnv("TRAJECTORIES_PATH", "data/trajectories.jsonl");
const K = readIntegerEnv("K", 3, 1);
const CONCURRENCY = readIntegerEnv("CONCURRENCY", 3, 1);
const TIMEOUT_MS = readIntegerEnv("TIMEOUT_MS", 600_000, 1);
const MAX_OUTPUT_BYTES = readIntegerEnv("MAX_OUTPUT_BYTES", 50_000_000, 1);
const MODEL = readStringEnv("MODEL", "minimax/minimax-m3");
const PROVIDER = readStringEnv("PROVIDER", "openrouter");
const THINKING_LEVEL = readStringEnv("THINKING_LEVEL", "medium");
const TMP_TASKS_PATH = readStringEnv("TMP_GENERATE_TASKS_PATH", ".tmp/generate-tasks.jsonl");
const TMP_OUTPUT_PATH = readStringEnv("TMP_GENERATE_OUTPUT_PATH", ".tmp/generate-output.jsonl");

await main();

async function main(): Promise<void> {
  if (!(await Bun.file(PROMPTS_PATH).exists())) await runScaffold();
  await ensureDir(dirname(TRAJECTORIES_PATH));
  await ensureDir(dirname(TMP_TASKS_PATH));
  const tasks = await readJsonl<Record<string, unknown>>(PROMPTS_PATH);
  const existing = isForce() ? [] : await readJsonl<Record<string, unknown>>(TRAJECTORIES_PATH);
  const counts = existingTrialCounts(existing);
  const pendingTasks = tasks.filter((task) => (counts.get(String(task.id)) ?? 0) < K);
  if (pendingTasks.length === 0) {
    console.error(`No generation work left. ${TRAJECTORIES_PATH} already has K=${K} rows per task.`);
    return;
  }
  if (isForce()) await removeIfExists(TRAJECTORIES_PATH);
  await writeJsonl(TMP_TASKS_PATH, pendingTasks);
  await removeIfExists(TMP_OUTPUT_PATH);
  const input = {
    mode: "run",
    tasksPath: TMP_TASKS_PATH,
    adapter: {
      command: ["bun", "run", "src/adapter.ts"],
      timeoutMs: TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      config: { model: MODEL, provider: PROVIDER, thinkingLevel: THINKING_LEVEL },
    },
    k: K,
    concurrency: CONCURRENCY,
    label: "minimax-m3-you-web",
    metadata: { source: "google/deepsearchqa" },
  };
  console.error(`Generating ${pendingTasks.length} tasks with K=${K}, concurrency=${CONCURRENCY}`);
  await runCommandToFile(["bunx", "agent-eval-harness", "eval", JSON.stringify(input)], TMP_OUTPUT_PATH);
  await appendFileContents(TRAJECTORIES_PATH, TMP_OUTPUT_PATH);
  console.error(`Appended generated trajectories to ${TRAJECTORIES_PATH}`);
}

async function runScaffold(): Promise<void> {
  console.error(`${PROMPTS_PATH} missing; running scaffold first.`);
  const proc = Bun.spawn({ cmd: ["bun", "run", "scaffold"], stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`scaffold failed with exit code ${exitCode}`);
}

function existingTrialCounts(rows: Record<string, unknown>[]): Map<string, number> {
  const byTask = new Map<string, Set<number>>();
  for (const row of rows) {
    const taskId = typeof row.taskId === "string" ? row.taskId : "";
    const trialIndex = typeof row.trialIndex === "number" ? row.trialIndex : undefined;
    if (!taskId || trialIndex === undefined) continue;
    const set = byTask.get(taskId) ?? new Set<number>();
    set.add(trialIndex);
    byTask.set(taskId, set);
  }
  return new Map([...byTask.entries()].map(([taskId, trialIndices]) => [taskId, trialIndices.size]));
}
