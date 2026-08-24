import { runSql, section, tables } from './lib.ts'

// Direction 3a (deeper dig into parameter compliance). Runs over data/graded.jsonl trial.trajectory.
// Direction 3 found avg search count = 3.93 and only 9 of 24,999 searches used count=30. The key
// question: is the model choosing small counts, or not specifying count at all (leaving the You.com
// tool default)? Bucket every started you-search call by whether count was specified and by its
// value. This decides whether the skill fix is "set count=30 explicitly" vs "the tool default is
// already low and the model never overrides it."
const sql = `
SELECT
  count_bucket,
  searches,
  round(searches / sum(searches) OVER (), 4) AS share
FROM (
  SELECT
    multiIf(
      NOT JSONHas(event, 'input', 'count'), 'count not specified',
      JSONExtractInt(event, 'input', 'count') <= 5, 'count 1-5',
      JSONExtractInt(event, 'input', 'count') <= 10, 'count 6-10',
      JSONExtractInt(event, 'input', 'count') < 30, 'count 11-29',
      JSONExtractInt(event, 'input', 'count') = 30, 'count 30',
      'count > 30'
    ) AS count_bucket,
    count() AS searches
  FROM ${tables.graded}
  ARRAY JOIN JSONExtractArrayRaw(json, 'trial', 'trajectory') AS event
  WHERE JSONExtractString(event, 'type') = 'tool_call'
    AND JSONExtractString(event, 'status') = 'started'
    AND JSONExtractString(event, 'name') = 'you-search'
  GROUP BY count_bucket
)
ORDER BY searches DESC
FORMAT PrettyCompact`.trim()

export async function run(): Promise<string> {
  return section({
    title: '3a. Search count: explicit value vs tool default',
    question:
      'Direction 3 found the model almost never uses the skill\'s prescribed count=30 (only 9 of 24,999 searches). Is the model choosing small counts, or not specifying count at all and relying on the You.com tool default? Bucket every started you-search call by whether count was specified and by its value. This determines whether the skill fix is "always set count=30 explicitly" versus "the tool default is already small and the model never overrides it."',
    sql,
    output: await runSql(sql),
  })
}

if (import.meta.main) await process.stdout.write(await run())
