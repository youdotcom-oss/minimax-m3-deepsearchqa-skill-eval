import { runSql, section, tables } from './lib.ts'

// Direction 1: tool-budget adherence vs. score. Runs on the flat, fast data/results.jsonl.
// The skill caps total tool calls at 10 and searches at ~6-8. Bucket gradable trials by total
// tool-call band and compare F1, pass rate, and the grader outcome mix.
const sql = `
SELECT
  band AS tool_call_band,
  count() AS trials,
  round(avg(score), 4) AS avg_score,
  round(countIf(pass) / count(), 4) AS pass_rate,
  countIf(fullyCorrect) AS fully_correct,
  countIf(partiallyCorrect) AS partially_correct,
  countIf(correctWithExtraneousAnswers) AS correct_with_extraneous,
  countIf(fullyIncorrect) AS fully_incorrect
FROM (
  SELECT
    multiIf(
      toolCallCount <= 10, '0-10 (within skill budget)',
      toolCallCount <= 20, '11-20',
      toolCallCount <= 40, '21-40',
      '41+'
    ) AS band,
    score, pass, fullyCorrect, partiallyCorrect, correctWithExtraneousAnswers, fullyIncorrect
  FROM (
    SELECT
      JSONExtractInt(json, 'toolCallCount') AS toolCallCount,
      JSONExtractFloat(json, 'score') AS score,
      JSONExtractBool(json, 'pass') AS pass,
      JSONExtractBool(json, 'gradable') AS gradable,
      JSONExtractBool(json, 'fullyCorrect') AS fullyCorrect,
      JSONExtractBool(json, 'partiallyCorrect') AS partiallyCorrect,
      JSONExtractBool(json, 'correctWithExtraneousAnswers') AS correctWithExtraneousAnswers,
      JSONExtractBool(json, 'fullyIncorrect') AS fullyIncorrect
    FROM ${tables.results}
  )
  WHERE gradable
)
GROUP BY band
ORDER BY band ASC
FORMAT PrettyCompact`.trim()

export async function run(): Promise<string> {
  return section({
    title: '1. Tool-budget adherence vs. score',
    question:
      'The skill caps total tool calls at 10 and searches at ~6-8. Do trials that stay within budget score better, or do the best trials overshoot? Bucket gradable trials by total tool-call band and compare F1, pass rate, and the grader outcome mix.',
    sql,
    output: await runSql(sql),
  })
}

if (import.meta.main) await process.stdout.write(await run())
