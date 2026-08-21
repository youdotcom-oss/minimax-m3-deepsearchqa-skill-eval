import { dirname } from 'node:path'
import { readIntegerEnv, readStringEnv } from '../src/env.ts'
import { ensureDir, writeJsonl } from '../src/io.ts'

interface DatasetRowEnvelope {
  row_idx: number
  row: Record<string, unknown>
}

interface RowsResponse {
  rows: DatasetRowEnvelope[]
  num_rows_total?: number
}

const DATASET = readStringEnv('DATASET', 'google/deepsearchqa')
const CONFIG = readStringEnv('HF_CONFIG', 'deepsearchqa')
const SPLIT = readStringEnv('HF_SPLIT', 'eval')
const OUTPUT = readStringEnv('PROMPTS_PATH', 'data/prompts.jsonl')
const PAGE_SIZE = readIntegerEnv('HF_PAGE_SIZE', 100, 1)
const LIMIT = process.env.LIMIT === undefined || process.env.LIMIT === '' ? undefined : readIntegerEnv('LIMIT', 0, 0)

await main()

async function main(): Promise<void> {
  await ensureDir(dirname(OUTPUT))
  const rows: unknown[] = []
  let offset = 0
  let total: number | undefined
  while (total === undefined || offset < total) {
    const length = LIMIT === undefined ? PAGE_SIZE : Math.min(PAGE_SIZE, LIMIT - rows.length)
    if (length <= 0) break
    const page = await fetchRows(offset, length)
    total = page.num_rows_total ?? offset + page.rows.length
    for (const envelope of page.rows) {
      rows.push(toTask(envelope))
      if (LIMIT !== undefined && rows.length >= LIMIT) break
    }
    if (page.rows.length === 0 || (LIMIT !== undefined && rows.length >= LIMIT)) break
    offset += page.rows.length
  }
  await writeJsonl(OUTPUT, rows)
  console.error(`Wrote ${rows.length} tasks to ${OUTPUT}`)
}

async function fetchRows(offset: number, length: number): Promise<RowsResponse> {
  const url = new URL('https://datasets-server.huggingface.co/rows')
  url.searchParams.set('dataset', DATASET)
  url.searchParams.set('config', CONFIG)
  url.searchParams.set('split', SPLIT)
  url.searchParams.set('offset', String(offset))
  url.searchParams.set('length', String(length))
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${await res.text()}`)
  return (await res.json()) as RowsResponse
}

function toTask(envelope: DatasetRowEnvelope): object {
  const row = envelope.row
  const id = stringField(row, 'id') ?? `deepsearchqa-${envelope.row_idx}`
  const prompt = stringField(row, 'problem') ?? stringField(row, 'question') ?? stringField(row, 'prompt')
  if (!prompt) throw new Error(`Row ${envelope.row_idx} has no problem/question/prompt field`)
  const expected = nullableStringField(row, 'answer') ?? nullableStringField(row, 'expected_answer')
  const answerType = stringField(row, 'answer_type') ?? 'Unknown'
  return {
    id,
    prompts: [prompt],
    metadata: {
      source: DATASET,
      row_idx: envelope.row_idx,
      problem_category: stringField(row, 'problem_category') ?? null,
      answer_type: answerType,
      expected_answer: expected,
      gradable: expected !== null && expected.trim() !== '',
    },
  }
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function nullableStringField(row: Record<string, unknown>, key: string): string | null {
  if (!(key in row)) return null
  const value = row[key]
  if (value === null || value === undefined) return null
  return String(value)
}
