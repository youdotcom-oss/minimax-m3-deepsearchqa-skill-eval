import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { readStringEnv } from "../src/env.ts";

const HF_TOKEN = readStringEnv("HF_TOKEN");
const HF_DATASET_REPO = readStringEnv("HF_DATASET_REPO", "youdotcom/minimax-m3-deepsearchqa-skill-eval");
const HF_REVISION = readStringEnv("HF_REVISION", "main");
const FILES = [
  { local: "README.md", remote: "README.md" },
  { local: "data/prompts.jsonl", remote: "prompts.jsonl" },
  { local: "data/trajectories.jsonl", remote: "trajectories.jsonl" },
  { local: "data/graded.jsonl", remote: "graded.jsonl" },
  { local: "data/summary.json", remote: "summary.json" },
];

await main();

async function main(): Promise<void> {
  for (const file of FILES) {
    if (!(await Bun.file(file.local).exists())) throw new Error(`${file.local} is missing`);
  }
  const lines: string[] = [JSON.stringify({ key: "header", value: { summary: "Update MiniMax M3 DeepSearchQA eval artifacts" } })];
  for (const file of FILES) {
    const bytes = await readFile(file.local);
    lines.push(JSON.stringify({ key: "file", value: { path: file.remote, content: bytes.toString("base64"), encoding: "base64" } }));
  }
  const repoPath = HF_DATASET_REPO.split("/").map(encodeURIComponent).join("/");
  const url = `https://huggingface.co/api/datasets/${repoPath}/commit/${encodeURIComponent(HF_REVISION)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${HF_TOKEN}`, "Content-Type": "application/x-ndjson" },
    body: lines.join("\n") + "\n",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HF upload failed ${res.status}: ${body}\nIf this fails because artifacts are too large for the regular commit API, upload with the official HF CLI from the same data files.`);
  }
  console.error(`Uploaded ${FILES.map((file) => basename(file.remote)).join(", ")} to ${HF_DATASET_REPO}@${HF_REVISION}`);
}
