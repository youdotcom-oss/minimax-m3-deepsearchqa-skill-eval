import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { dirname } from 'node:path'
import { ensureDir } from './io.ts'
import { collectLatestRowLines, streamLatestRows } from './trial-rows.ts'
import { youApiUsageForTrial } from './you-cost.ts'

type JsonObject = Record<string, unknown>

export interface ResultRow {
  label: string
  taskId: string
  trialIndex: number
  trialId: string
  model: string
  provider: string
  thinkingLevel: string
  status: string
  score: number
  pass: boolean
  gradable: boolean
  fullyCorrect: boolean
  fullyIncorrect: boolean
  correctWithExtraneousAnswers: boolean
  partiallyCorrect: boolean
  correctCount: number
  expectedCount: number
  excessiveCount: number
  durationMs: number
  toolCallCount: number
  failedToolCallCount: number
  errorCount: number
  modelCostUsd: number
  youApiCostUsd: number
  totalCostUsd: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  searchCalls: number
  searchExtractionPages: number
  contentsCalls: number
  contentsPages: number
}

export function toResultRow(row: unknown): ResultRow {
  const object = asObject(row) ?? {}
  const trial = asObject(object.trial) ?? {}
  const result = asObject(trial.result) ?? {}
  const invocation = asObject(trial.invocation) ?? {}
  const process = asObject(object.process) ?? {}
  const trialMetadata = asObject(trial.metadata) ?? {}
  const usage = asObject(trialMetadata.usage) ?? {}
  const youApiUsage = youApiUsageForTrial(trial)
  const answerResult = Array.isArray(object.graderResults)
    ? object.graderResults.map(asObject).find((grader) => grader?.id === 'deepsearchqa-answer')
    : undefined
  const outcome = asObject(answerResult?.outcome) ?? {}
  const score = clamp01(numberValue(answerResult?.score ?? object.score))
  const gradable = booleanValue(outcome.gradable, true)
  const correctCount = numberValue(outcome.correctCount)
  const expectedCount = numberValue(outcome.expectedCount)
  const excessiveCount = numberValue(outcome.excessiveCount)
  const fullyCorrect = gradable && score === 1
  const fullyIncorrect = gradable && score === 0
  const correctWithExtraneousAnswers =
    gradable && expectedCount > 0 && correctCount >= expectedCount && excessiveCount > 0
  const partiallyCorrect = gradable && correctCount > 0 && !fullyCorrect && !correctWithExtraneousAnswers
  const modelCostUsd = roundNumber(numberValue(usage.costUsd))
  const youApiCostUsd = roundNumber(numberValue(youApiUsage.costUsd))

  return {
    label: stringValue(object.label),
    taskId: stringValue(object.taskId),
    trialIndex: numberValue(object.trialIndex),
    trialId: stringValue(object.trialId),
    model: stringValue(trialMetadata.model),
    provider: stringValue(trialMetadata.provider),
    thinkingLevel: stringValue(trialMetadata.thinkingLevel),
    status: stringValue(result.status),
    score,
    pass: gradable && booleanValue(answerResult?.pass ?? object.pass, false) && score >= 0.8,
    gradable,
    fullyCorrect,
    fullyIncorrect,
    correctWithExtraneousAnswers,
    partiallyCorrect,
    correctCount,
    expectedCount,
    excessiveCount,
    durationMs: numberValue(invocation.durationMs),
    toolCallCount: numberValue(process.toolCallCount),
    failedToolCallCount: numberValue(process.failedToolCallCount),
    errorCount: numberValue(process.errorCount),
    modelCostUsd,
    youApiCostUsd,
    totalCostUsd: roundNumber(modelCostUsd + youApiCostUsd),
    inputTokens: numberValue(usage.inputTokens),
    outputTokens: numberValue(usage.outputTokens),
    totalTokens: numberValue(usage.totalTokens),
    searchCalls: numberValue(youApiUsage.searchCalls),
    searchExtractionPages: numberValue(youApiUsage.searchExtractionPages),
    contentsCalls: numberValue(youApiUsage.contentsCalls),
    contentsPages: numberValue(youApiUsage.contentsPages),
  }
}

export async function writeResultsFromJsonl(outputPath: string, gradedPath: string): Promise<number> {
  const latestLines = await collectLatestRowLines(gradedPath)
  await ensureDir(dirname(outputPath))
  const writer = createWriteStream(outputPath, { flags: 'w' })
  let count = 0

  for await (const row of streamLatestRows(gradedPath, latestLines)) {
    if (!writer.write(`${JSON.stringify(toResultRow(row))}\n`)) await once(writer, 'drain')
    count += 1
  }

  writer.end()
  await once(writer, 'finish')
  return count
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function roundNumber(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000
}
