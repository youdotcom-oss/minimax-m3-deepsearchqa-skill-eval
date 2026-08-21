import { describe, expect, test } from 'bun:test'
import { buildClickHousePlan, listQueryPresets } from '../src/query.ts'

describe('ClickHouse query planning', () => {
  test('builds a dry-run friendly command for a preset', () => {
    const plan = buildClickHousePlan({
      preset: 'summary',
      gradedPath: 'data/graded.jsonl',
      trajectoriesPath: 'data/trajectories.jsonl',
      clickhouseCommand: ['clickhouse-local'],
    })

    expect(plan.command).toEqual(['clickhouse-local', '--query', plan.query])
    expect(plan.query).toContain("file('data/graded.jsonl', 'JSONAsString', 'json String')")
    expect(plan.query).toContain("JSONExtractString(json, 'taskId')")
    expect(plan.query).toContain('FORMAT PrettyCompact')
  })

  test('escapes artifact paths as SQL string literals', () => {
    const plan = buildClickHousePlan({
      preset: 'latency-outliers',
      gradedPath: "data/graded's.jsonl",
      trajectoriesPath: 'data/trajectories.jsonl',
      clickhouseCommand: ['clickhouse-local'],
    })

    expect(plan.query).toContain("file('data/graded''s.jsonl', 'JSONAsString', 'json String')")
  })

  test('exposes curated presets for agent-facing help', () => {
    expect(listQueryPresets()).toEqual([
      'summary',
      'failures',
      'cost-outliers',
      'latency-outliers',
      'tool-counts',
      'ungradable',
      'score-histogram',
    ])
  })
})
