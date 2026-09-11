import { collectLatestRowLines, streamLatestRows } from './trial-rows.ts'
import { youApiUsageForTrial } from './you-cost.ts'

type JsonObject = Record<string, unknown>

export interface ScoredTrial {
  taskId: string
  trialIndex: number
  score: number
  pass: boolean
  gradable: boolean
  toolCallCount?: number
  failedToolCallCount?: number
  errorCount?: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  costUsd: number
  youApiCostUsd: number
  searchCalls: number
  searchExtractionPages: number
  contentsCalls: number
  contentsPages: number
  searchCostUsd: number
  searchExtractionCostUsd: number
  contentsCostUsd: number
  durationMs: number
}

export interface MetricBlock {
  trialCount: number
  taskCount: number
  averageScore: number
  passCount: number
  passRate: number
  exactPassAtKCount: number
  exactPassAtK: number
}

export interface Summary {
  generatedAt: string
  label: string | null
  model: string
  k: number
  raw: MetricBlock
  adjusted: MetricBlock
  ungradableTrialCount: number
  ungradableTaskCount: number
  process: {
    totalToolCalls: number
    averageToolCallsPerTrial: number
    failedToolCallCount: number
    errorCount: number
  }
  cost: {
    modelCostUsd: number
    youApiCostUsd: number
    totalCostUsd: number
    searchCalls: number
    searchExtractionPages: number
    contentsCalls: number
    contentsPages: number
    searchCostUsd: number
    searchExtractionCostUsd: number
    contentsCostUsd: number
    averageTotalCostUsdPerTrial: number
    averageTotalCostUsdPerTask: number
    adjustedTotalCostUsd: number
    adjustedAverageTotalCostUsdPerTrial: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    totalTokens: number
  }
  latency: {
    averageEndToEndMs: number
  }
}

export function f1Score(correctCount: number, expectedCount: number, excessiveCount: number): number {
  if (expectedCount <= 0) return 0
  const safeCorrect = Math.max(0, Math.min(correctCount, expectedCount))
  const safeExcessive = Math.max(0, excessiveCount)
  const precisionDenominator = safeCorrect + safeExcessive
  const precision = precisionDenominator === 0 ? 0 : safeCorrect / precisionDenominator
  const recall = safeCorrect / expectedCount
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall)
}

export function buildSummary(rows: unknown[], options: { k: number; model: string }): Summary {
  const scoredRows = rows.map(toScoredTrial)
  return buildSummaryFromScoredRows(scoredRows, readLabel(rows), options)
}

function buildSummaryFromScoredRows(
  scoredRows: ScoredTrial[],
  label: string | null,
  options: { k: number; model: string },
): Summary {
  const adjustedRows = scoredRows.filter((row) => row.gradable)
  return {
    generatedAt: new Date().toISOString(),
    label,
    model: options.model,
    k: options.k,
    raw: computeMetricBlock(scoredRows),
    adjusted: computeMetricBlock(adjustedRows),
    ungradableTrialCount: scoredRows.filter((row) => !row.gradable).length,
    ungradableTaskCount: new Set(scoredRows.filter((row) => !row.gradable).map((row) => row.taskId)).size,
    process: {
      totalToolCalls: sum(scoredRows.map((row) => row.toolCallCount ?? 0)),
      averageToolCallsPerTrial: scoredRows.length
        ? sum(scoredRows.map((row) => row.toolCallCount ?? 0)) / scoredRows.length
        : 0,
      failedToolCallCount: sum(scoredRows.map((row) => row.failedToolCallCount ?? 0)),
      errorCount: sum(scoredRows.map((row) => row.errorCount ?? 0)),
    },
    cost: computeCostBlock(scoredRows, adjustedRows),
    latency: computeLatencyBlock(scoredRows),
  }
}

export async function writeSummaryFromJsonl(
  path: string,
  rowsPath: string,
  options: { k: number; model: string },
): Promise<Summary> {
  const latestLines = await collectLatestRowLines(rowsPath)
  const scoredRows: ScoredTrial[] = []
  let label: string | null = null
  for await (const row of streamLatestRows(rowsPath, latestLines)) {
    if (label === null) label = rowLabel(row)
    scoredRows.push(toScoredTrial(row))
  }
  const summary = buildSummaryFromScoredRows(scoredRows, label, options)
  await Bun.write(path, JSON.stringify(summary, null, 2) + '\n')
  return summary
}

function computeMetricBlock(rows: ScoredTrial[]): MetricBlock {
  const taskIds = new Set(rows.map((row) => row.taskId))
  const passingTasks = new Set(rows.filter((row) => row.pass).map((row) => row.taskId))
  const passCount = rows.filter((row) => row.pass).length
  return {
    trialCount: rows.length,
    taskCount: taskIds.size,
    averageScore: rows.length ? sum(rows.map((row) => row.score)) / rows.length : 0,
    passCount,
    passRate: rows.length ? passCount / rows.length : 0,
    exactPassAtKCount: passingTasks.size,
    exactPassAtK: taskIds.size ? passingTasks.size / taskIds.size : 0,
  }
}

function computeCostBlock(rows: ScoredTrial[], adjustedRows: ScoredTrial[]): Summary['cost'] {
  const modelCostUsd = sum(rows.map((row) => row.costUsd))
  const youApiCostUsd = sum(rows.map((row) => row.youApiCostUsd))
  const totalCostUsd = modelCostUsd + youApiCostUsd
  const adjustedTotalCostUsd = sum(adjustedRows.map((row) => row.costUsd + row.youApiCostUsd))
  const taskCount = new Set(rows.map((row) => row.taskId)).size
  return {
    modelCostUsd,
    youApiCostUsd,
    totalCostUsd,
    searchCalls: sum(rows.map((row) => row.searchCalls)),
    searchExtractionPages: sum(rows.map((row) => row.searchExtractionPages)),
    contentsCalls: sum(rows.map((row) => row.contentsCalls)),
    contentsPages: sum(rows.map((row) => row.contentsPages)),
    searchCostUsd: sum(rows.map((row) => row.searchCostUsd)),
    searchExtractionCostUsd: sum(rows.map((row) => row.searchExtractionCostUsd)),
    contentsCostUsd: sum(rows.map((row) => row.contentsCostUsd)),
    averageTotalCostUsdPerTrial: rows.length ? totalCostUsd / rows.length : 0,
    averageTotalCostUsdPerTask: taskCount ? totalCostUsd / taskCount : 0,
    adjustedTotalCostUsd,
    adjustedAverageTotalCostUsdPerTrial: adjustedRows.length ? adjustedTotalCostUsd / adjustedRows.length : 0,
    inputTokens: sum(rows.map((row) => row.inputTokens)),
    outputTokens: sum(rows.map((row) => row.outputTokens)),
    cacheReadTokens: sum(rows.map((row) => row.cacheReadTokens)),
    cacheWriteTokens: sum(rows.map((row) => row.cacheWriteTokens)),
    totalTokens: sum(rows.map((row) => row.totalTokens)),
  }
}

function computeLatencyBlock(rows: ScoredTrial[]): Summary['latency'] {
  return {
    averageEndToEndMs: rows.length ? sum(rows.map((row) => row.durationMs)) / rows.length : 0,
  }
}

function toScoredTrial(row: unknown): ScoredTrial {
  const object = asObject(row) ?? {}
  const trial = asObject(object.trial) ?? {}
  const task = asObject(trial.task) ?? {}
  const metadata = asObject(task.metadata) ?? {}
  const trialMetadata = asObject(trial.metadata) ?? {}
  const invocation = asObject(trial.invocation) ?? {}
  const usage = asObject(trialMetadata.usage) ?? {}
  const youApiUsage = youApiUsageForTrial(trial)
  const process = asObject(object.process) ?? {}
  const answerResult = Array.isArray(object.graderResults)
    ? object.graderResults.map(asObject).find((result) => result?.id === 'deepsearchqa-answer')
    : undefined
  const outcome = asObject(answerResult?.outcome) ?? {}
  const gradable =
    typeof outcome.gradable === 'boolean'
      ? outcome.gradable
      : metadata.gradable !== false && metadata.expected_answer != null && metadata.expected_answer !== ''
  const score = gradable ? clamp01(numberValue(answerResult?.score ?? object.score)) : 0
  return {
    taskId: String(object.taskId ?? ''),
    trialIndex: numberValue(object.trialIndex),
    score,
    pass: gradable && Boolean(answerResult?.pass ?? object.pass) && score >= 0.8,
    gradable,
    toolCallCount: numberValue(process.toolCallCount),
    failedToolCallCount: numberValue(process.failedToolCallCount),
    errorCount: numberValue(process.errorCount),
    inputTokens: numberValue(usage.inputTokens),
    outputTokens: numberValue(usage.outputTokens),
    cacheReadTokens: numberValue(usage.cacheReadTokens),
    cacheWriteTokens: numberValue(usage.cacheWriteTokens),
    totalTokens: numberValue(usage.totalTokens),
    costUsd: numberValue(usage.costUsd),
    youApiCostUsd: numberValue(youApiUsage.costUsd),
    searchCalls: numberValue(youApiUsage.searchCalls),
    searchExtractionPages: numberValue(youApiUsage.searchExtractionPages),
    contentsCalls: numberValue(youApiUsage.contentsCalls),
    contentsPages: numberValue(youApiUsage.contentsPages),
    searchCostUsd: numberValue(youApiUsage.searchCostUsd),
    searchExtractionCostUsd: numberValue(youApiUsage.searchExtractionCostUsd),
    contentsCostUsd: numberValue(youApiUsage.contentsCostUsd),
    durationMs: numberValue(invocation.durationMs),
  }
}

function readLabel(rows: unknown[]): string | null {
  for (const row of rows) {
    const label = rowLabel(row)
    if (label !== null) return label
  }
  return null
}

function rowLabel(row: unknown): string | null {
  const label = asObject(row)?.label
  return typeof label === 'string' ? label : null
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
