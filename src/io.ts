import { appendFile, mkdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname } from "node:path";
import { once } from "node:events";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export async function readStdin(): Promise<unknown> {
  const text = await Bun.stdin.text();
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error("No input received on stdin.");
  return JSON.parse(trimmed);
}

export function writeStdout(output: unknown): void {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function removeIfExists(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

export async function readJsonl<T = unknown>(path: string): Promise<T[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const text = await file.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await ensureDir(dirname(path));
  await Bun.write(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

export async function appendJsonl(path: string, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  await ensureDir(dirname(path));
  await appendFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

export async function appendFileContents(destination: string, source: string): Promise<void> {
  await ensureDir(dirname(destination));
  const writer = createWriteStream(destination, { flags: "a" });
  for await (const chunk of Bun.file(source).stream()) {
    if (!writer.write(chunk)) await once(writer, "drain");
  }
  writer.end();
  await once(writer, "finish");
}

export async function runCommandToFile(command: string[], stdoutPath: string): Promise<void> {
  await ensureDir(dirname(stdoutPath));
  const proc = Bun.spawn({ cmd: command, stdout: "pipe", stderr: "inherit", stdin: "inherit" });
  const writer = createWriteStream(stdoutPath, { flags: "w" });
  for await (const chunk of proc.stdout) {
    if (!writer.write(chunk)) await once(writer, "drain");
  }
  writer.end();
  await once(writer, "finish");
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
  }
}

export function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}
