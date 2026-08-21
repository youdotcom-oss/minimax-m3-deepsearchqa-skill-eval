import { streamJsonl } from './io.ts'

export type TrialJsonRow = Record<string, unknown>

const encoder = new TextEncoder()

export function trialRowKey(row: TrialJsonRow): string {
  return typeof row.taskId === 'string' && typeof row.trialIndex === 'number' ? `${row.taskId}\t${row.trialIndex}` : ''
}

export async function collectRowKeys(path: string): Promise<Set<string>> {
  const keys = new Set<string>()
  for await (const { value } of streamJsonl<TrialJsonRow>(path)) {
    const key = trialRowKey(value)
    if (key) keys.add(key)
  }
  return keys
}

export async function collectLatestRowLines(path: string): Promise<Map<string, number>> {
  const latestLines = new Map<string, number>()
  for await (const { line, value } of streamJsonl<TrialJsonRow>(path)) {
    const key = trialRowKey(value)
    if (key) latestLines.set(key, line)
  }
  return latestLines
}

export async function collectTrialCounts(path: string): Promise<Map<string, number>> {
  const byTask = new Map<string, Set<number>>()
  for await (const { value } of streamJsonl<TrialJsonRow>(path)) {
    const taskId = typeof value.taskId === 'string' ? value.taskId : ''
    const trialIndex = typeof value.trialIndex === 'number' ? value.trialIndex : undefined
    if (!taskId || trialIndex === undefined) continue
    const trialIndices = byTask.get(taskId) ?? new Set<number>()
    trialIndices.add(trialIndex)
    byTask.set(taskId, trialIndices)
  }
  return new Map([...byTask.entries()].map(([taskId, trialIndices]) => [taskId, trialIndices.size]))
}

export async function* streamLatestRows(path: string, latestLines: Map<string, number>): AsyncGenerator<TrialJsonRow> {
  for await (const { line, value } of streamJsonl<TrialJsonRow>(path)) {
    const key = trialRowKey(value)
    if (key && latestLines.get(key) === line) yield value
  }
}

export function* chunkRowsForHarness(rows: Iterable<TrialJsonRow>, maxBytes: number): Generator<TrialJsonRow[]> {
  let chunk: TrialJsonRow[] = []
  let chunkBytes = 0

  for (const row of rows) {
    const rowBytes = jsonlRowByteLength(row)
    if (chunk.length > 0 && chunkBytes + rowBytes > maxBytes) {
      yield chunk
      chunk = []
      chunkBytes = 0
    }
    chunk.push(row)
    chunkBytes += rowBytes
  }

  if (chunk.length > 0) yield chunk
}

export async function* streamChunksForHarness(
  rows: AsyncIterable<TrialJsonRow>,
  maxBytes: number,
): AsyncGenerator<TrialJsonRow[]> {
  let chunk: TrialJsonRow[] = []
  let chunkBytes = 0

  for await (const row of rows) {
    const rowBytes = jsonlRowByteLength(row)
    if (chunk.length > 0 && chunkBytes + rowBytes > maxBytes) {
      yield chunk
      chunk = []
      chunkBytes = 0
    }
    chunk.push(row)
    chunkBytes += rowBytes
  }

  if (chunk.length > 0) yield chunk
}

function jsonlRowByteLength(row: TrialJsonRow): number {
  return encoder.encode(JSON.stringify(row)).length + 1
}
