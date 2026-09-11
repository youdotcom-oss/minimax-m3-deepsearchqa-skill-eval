import { describe, expect, test } from 'bun:test'
import { normalizeMessageRole } from '../src/adapter.ts'
import { scoreJudgeResult } from '../src/grader.ts'
import { collectFinalMessage } from '../src/pi-session.ts'
import { buildSummary, f1Score, writeSummaryFromJsonl } from '../src/summary.ts'
import {
  chunkRowsForHarness,
  collectLatestRowLines,
  collectRowKeys,
  streamLatestRows,
  trialRowKey,
} from '../src/trial-rows.ts'
import { estimateYouApiUsage } from '../src/you-cost.ts'

describe('answer scoring', () => {
  test('computes F1 from correct, missing, and excessive answer parts', () => {
    expect(f1Score(2, 3, 1)).toBeCloseTo(2 / 3, 8)
  })

  test('passes at score >= 0.8', () => {
    const scored = scoreJudgeResult({
      details: [
        { expected: 'A', found: true },
        { expected: 'B', found: true },
        { expected: 'C', found: true },
      ],
      excessiveAnswers: ['D'],
      rationale: 'one extra',
    })
    expect(scored.score).toBeCloseTo(6 / 7, 8)
    expect(scored.pass).toBe(true)
  })

  test('penalizes excessive set-answer items', () => {
    const scored = scoreJudgeResult({
      details: [
        { expected: 'A', found: true },
        { expected: 'B', found: true },
      ],
      excessiveAnswers: ['C', 'D'],
      rationale: 'two extras',
    })
    expect(scored.score).toBeCloseTo(2 / 3, 8)
    expect(scored.pass).toBe(false)
  })
})

describe('summary metrics', () => {
  test('raw includes ungradable rows while adjusted excludes them', () => {
    const rows = [
      row('deepsearchqa-1', 0, 1, true, true, {
        modelCostUsd: 0.25,
        youApiCostUsd: 0.01,
        searchCalls: 2,
        searchCostUsd: 0.01,
        durationMs: 1000,
      }),
      row('deepsearchqa-1', 1, 0.5, false, true, {
        modelCostUsd: 0.75,
        youApiCostUsd: 0.02,
        searchExtractionPages: 20,
        searchExtractionCostUsd: 0.02,
        durationMs: 2000,
      }),
      row('deepsearchqa-110', 0, 0, false, false, {
        modelCostUsd: 0.5,
        youApiCostUsd: 0.03,
        contentsPages: 30,
        contentsCostUsd: 0.03,
        durationMs: 3000,
      }),
    ]
    const summary = buildSummary(rows, { k: 2, model: 'minimax/minimax-m3' })
    expect(summary.raw.trialCount).toBe(3)
    expect(summary.raw.taskCount).toBe(2)
    expect(summary.raw.averageScore).toBeCloseTo(0.5, 8)
    expect(summary.raw.exactPassAtK).toBeCloseTo(0.5, 8)
    expect(summary.adjusted.trialCount).toBe(2)
    expect(summary.adjusted.taskCount).toBe(1)
    expect(summary.adjusted.averageScore).toBeCloseTo(0.75, 8)
    expect(summary.adjusted.exactPassAtK).toBe(1)
    expect(summary.ungradableTrialCount).toBe(1)
    expect(summary.cost.modelCostUsd).toBeCloseTo(1.5, 8)
    expect(summary.cost.youApiCostUsd).toBeCloseTo(0.06, 8)
    expect(summary.cost.totalCostUsd).toBeCloseTo(1.56, 8)
    expect(summary.cost.searchCalls).toBe(2)
    expect(summary.cost.searchExtractionPages).toBe(20)
    expect(summary.cost.contentsPages).toBe(30)
    expect(summary.cost.searchCostUsd).toBeCloseTo(0.01, 8)
    expect(summary.cost.searchExtractionCostUsd).toBeCloseTo(0.02, 8)
    expect(summary.cost.contentsCostUsd).toBeCloseTo(0.03, 8)
    expect(summary.cost.averageTotalCostUsdPerTrial).toBeCloseTo(0.52, 8)
    expect(summary.cost.adjustedTotalCostUsd).toBeCloseTo(1.03, 8)
    expect(summary.cost.adjustedAverageTotalCostUsdPerTrial).toBeCloseTo(0.515, 8)
    expect(summary.latency.averageEndToEndMs).toBe(2000)
  })

  test('streams and dedupes summary rows from JSONL', async () => {
    const gradedPath = `${import.meta.dir}/../.tmp/test-graded-summary.jsonl`
    const summaryPath = `${import.meta.dir}/../.tmp/test-summary.json`
    await Bun.write(
      gradedPath,
      [
        JSON.stringify(row('deepsearchqa-1', 0, 0, false, true)),
        JSON.stringify(row('deepsearchqa-1', 0, 1, true, true)),
        JSON.stringify(row('deepsearchqa-2', 0, 0.5, false, true)),
      ].join('\n') + '\n',
    )

    const summary = await writeSummaryFromJsonl(summaryPath, gradedPath, { k: 1, model: 'minimax/minimax-m3' })

    expect(summary.raw.trialCount).toBe(2)
    expect(summary.raw.averageScore).toBe(0.75)
    expect(summary.raw.exactPassAtK).toBe(0.5)
  })
})

describe('You.com cost estimation', () => {
  test('estimates dash-cased search, full-page extraction, and contents costs', () => {
    const cost = estimateYouApiUsage([
      { type: 'tool_call', name: 'you-search', status: 'started', input: { query: 'x' } },
      {
        type: 'tool_call',
        name: 'you-search',
        status: 'completed',
        output: {
          details: {
            results: {
              web: Array.from({ length: 10 }, (_, index) => ({
                url: `https://example.com/web-${index}`,
                contents: { markdown: 'page' },
              })),
              news: Array.from({ length: 10 }, (_, index) => ({
                url: `https://example.com/news-${index}`,
                contents: { markdown: 'page' },
              })),
            },
          },
        },
      },
      {
        type: 'tool_call',
        name: 'you-contents',
        status: 'started',
        input: { urls: ['https://example.com/a', 'https://example.com/b'] },
      },
    ])

    expect(cost.searchCalls).toBe(1)
    expect(cost.searchExtractionPages).toBe(20)
    expect(cost.contentsCalls).toBe(1)
    expect(cost.contentsPages).toBe(2)
    expect(cost.searchCostUsd).toBeCloseTo(0.005, 8)
    expect(cost.searchExtractionCostUsd).toBeCloseTo(0.02, 8)
    expect(cost.contentsCostUsd).toBeCloseTo(0.002, 8)
    expect(cost.costUsd).toBeCloseTo(0.027, 8)
  })

  test('does not bill highlights-mode contents as full-page extractions', () => {
    const cost = estimateYouApiUsage([
      { type: 'tool_call', name: 'you-search', status: 'started', input: { query: 'x' } },
      {
        type: 'tool_call',
        name: 'you-search',
        status: 'completed',
        output: {
          details: {
            results: {
              web: [
                { url: 'https://example.com/a', contents: { highlights: ['passage'] } },
                { url: 'https://example.com/b', description: 'snippet only' },
                { url: 'https://example.com/c', contents: { html: '<html>full page</html>' } },
              ],
            },
          },
        },
      },
    ])

    expect(cost.searchCalls).toBe(1)
    expect(cost.searchExtractionPages).toBe(1)
    expect(cost.searchExtractionCostUsd).toBeCloseTo(0.001, 8)
    expect(cost.costUsd).toBeCloseTo(0.006, 8)
  })
})

describe('adapter schema compatibility', () => {
  test('maps Pi toolResult messages to harness tool messages', () => {
    expect(normalizeMessageRole('toolResult')).toBe('tool')
    expect(normalizeMessageRole('assistant')).toBe('assistant')
    expect(normalizeMessageRole('unexpected')).toBeUndefined()
  })

  test('does not reuse stale assistant text when the final assistant turn is blank', () => {
    const session = {
      messages: [
        { role: 'assistant', content: 'I am still researching this.' },
        { role: 'toolResult', content: 'tool output' },
        { role: 'assistant', content: '' },
      ],
    }
    expect(collectFinalMessage(session as unknown as Parameters<typeof collectFinalMessage>[0])).toBe('')
  })
})

describe('streamed trial rows', () => {
  test('streams only the latest row per task and trial index', async () => {
    const path = `${import.meta.dir}/../.tmp/test-latest-rows.jsonl`
    await Bun.write(
      path,
      [
        JSON.stringify({ taskId: 'task-1', trialIndex: 0, value: 'stale' }),
        JSON.stringify({ taskId: 'task-1', trialIndex: 1, value: 'other' }),
        JSON.stringify({ taskId: 'task-1', trialIndex: 0, value: 'latest' }),
      ].join('\n') + '\n',
    )

    const latestLines = await collectLatestRowLines(path)
    const rows = []
    for await (const row of streamLatestRows(path, latestLines)) rows.push(row)

    expect(rows.map((row) => row.value)).toEqual(['other', 'latest'])
    expect(await collectRowKeys(path)).toEqual(new Set(['task-1\t0', 'task-1\t1']))
    expect(trialRowKey(rows[1] ?? {})).toBe('task-1\t0')
  })

  test('chunks rows by serialized JSONL byte size', async () => {
    const chunks = [...chunkRowsForHarness([{ id: 'a' }, { id: 'bbbbbbbbbb' }, { id: 'c' }], 20)]
    expect(chunks).toEqual([[{ id: 'a' }], [{ id: 'bbbbbbbbbb' }], [{ id: 'c' }]])
  })
})

function row(
  taskId: string,
  trialIndex: number,
  score: number,
  pass: boolean,
  gradable: boolean,
  cost: {
    modelCostUsd?: number
    youApiCostUsd?: number
    searchCalls?: number
    searchExtractionPages?: number
    contentsCalls?: number
    contentsPages?: number
    searchCostUsd?: number
    searchExtractionCostUsd?: number
    contentsCostUsd?: number
    durationMs?: number
  } = {},
): object {
  return {
    taskId,
    trialIndex,
    trial: {
      task: { metadata: { expected_answer: gradable ? 'gold' : null, gradable } },
      metadata: {
        usage: { costUsd: cost.modelCostUsd ?? 0 },
        youApiUsage: {
          costUsd: cost.youApiCostUsd ?? 0,
          searchCalls: cost.searchCalls ?? 0,
          searchExtractionPages: cost.searchExtractionPages ?? 0,
          contentsCalls: cost.contentsCalls ?? 0,
          contentsPages: cost.contentsPages ?? 0,
          searchCostUsd: cost.searchCostUsd ?? 0,
          searchExtractionCostUsd: cost.searchExtractionCostUsd ?? 0,
          contentsCostUsd: cost.contentsCostUsd ?? 0,
        },
      },
      invocation: { durationMs: cost.durationMs ?? 0 },
    },
    process: { toolCallCount: 2, failedToolCallCount: 0, errorCount: 0 },
    graderResults: [
      {
        id: 'deepsearchqa-answer',
        type: 'command',
        required: true,
        weight: 1,
        skipped: false,
        pass,
        score,
        reasoning: 'test',
        outcome: { gradable },
      },
    ],
  }
}
