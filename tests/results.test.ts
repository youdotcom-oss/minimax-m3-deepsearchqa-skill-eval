import { describe, expect, test } from 'bun:test'
import { toResultRow } from '../src/results.ts'

describe('viewer-safe result rows', () => {
  test('projects a graded harness row to a flat stable schema', () => {
    const result = toResultRow({
      label: 'minimax-m3-you-web',
      taskId: 'deepsearchqa-1',
      trialIndex: 2,
      trialId: 'trial-1',
      pass: true,
      trial: {
        result: { status: 'completed' },
        invocation: { durationMs: 1234 },
        metadata: {
          model: 'minimax/minimax-m3',
          provider: 'openrouter',
          thinkingLevel: 'medium',
          usage: { costUsd: 0.12, inputTokens: 10, outputTokens: 3, totalTokens: 13 },
          youApiUsage: {
            costUsd: 0.04,
            searchCalls: 2,
            searchExtractionPages: 5,
            contentsCalls: 1,
            contentsPages: 7,
          },
        },
      },
      process: { toolCallCount: 4, failedToolCallCount: 1, errorCount: 0 },
      graderResults: [
        {
          id: 'deepsearchqa-answer',
          pass: true,
          score: 0.8,
          outcome: { gradable: true, correctCount: 2, expectedCount: 2, excessiveCount: 1 },
        },
      ],
    })

    expect(result).toEqual({
      label: 'minimax-m3-you-web',
      taskId: 'deepsearchqa-1',
      trialIndex: 2,
      trialId: 'trial-1',
      model: 'minimax/minimax-m3',
      provider: 'openrouter',
      thinkingLevel: 'medium',
      status: 'completed',
      score: 0.8,
      pass: true,
      gradable: true,
      fullyCorrect: false,
      fullyIncorrect: false,
      correctWithExtraneousAnswers: true,
      partiallyCorrect: false,
      correctCount: 2,
      expectedCount: 2,
      excessiveCount: 1,
      durationMs: 1234,
      toolCallCount: 4,
      failedToolCallCount: 1,
      errorCount: 0,
      modelCostUsd: 0.12,
      youApiCostUsd: 0.04,
      totalCostUsd: 0.16,
      inputTokens: 10,
      outputTokens: 3,
      totalTokens: 13,
      searchCalls: 2,
      searchExtractionPages: 5,
      contentsCalls: 1,
      contentsPages: 7,
    })
  })
})
