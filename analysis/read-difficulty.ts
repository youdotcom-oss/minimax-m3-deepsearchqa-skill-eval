import { runSql, section, tables } from './lib.ts'

// Direction 2a (deeper dig into read discipline). Runs on the flat, fast data/results.jsonl.
// Direction 2 found snippet-only (0 reads) trials scored highest, contradicting the skill's
// "always read" rule. Test whether that is a difficulty confound: bucket gradable trials by both
// read count and expectedCount (gold answer parts, a difficulty proxy). If 0-read wins cluster at
// expectedCount=1 (single-fact, easy), the high score reflects easy questions answered from
// parametric knowledge, not a real failure of the read rule.
const sql = `
SELECT
  multiIf(
    contentsCalls = 0, '0 reads',
    contentsCalls <= 2, '1-2 reads',
    contentsCalls <= 5, '3-5 reads',
    '6+ reads'
  ) AS read_band,
  multiIf(
    expectedCount = 1, '1 (single-fact)',
    expectedCount = 2, '2 parts',
    '3+ parts'
  ) AS difficulty,
  count() AS trials,
  round(avg(score), 4) AS avg_score,
  round(countIf(pass) / count(), 4) AS pass_rate
FROM (
  SELECT
    JSONExtractInt(json, 'contentsCalls') AS contentsCalls,
    JSONExtractInt(json, 'expectedCount') AS expectedCount,
    JSONExtractFloat(json, 'score') AS score,
    JSONExtractBool(json, 'pass') AS pass,
    JSONExtractBool(json, 'gradable') AS gradable
  FROM ${tables.results}
)
WHERE gradable
GROUP BY read_band, difficulty
ORDER BY read_band ASC, difficulty ASC
FORMAT PrettyCompact`.trim()

export async function run(): Promise<string> {
  return section({
    title: '2a. Read discipline by question difficulty',
    question:
      'Direction 2 found snippet-only (0 reads) trials scored highest, which contradicts the skill\'s "always read" rule. Is that a difficulty confound? Cross-tabulate read count by expectedCount (gold answer parts, a difficulty proxy): if 0-read wins cluster at single-fact (expectedCount=1) questions, the high score reflects easy questions answered from parametric knowledge, not a real failure of the read rule.',
    sql,
    output: await runSql(sql),
  })
}

if (import.meta.main) await process.stdout.write(await run())
