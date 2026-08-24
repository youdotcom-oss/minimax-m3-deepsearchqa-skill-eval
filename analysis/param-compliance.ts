import { runSql, section, tables } from './lib.ts'

// Direction 3: tool-call parameter compliance. Runs over data/graded.jsonl trial.trajectory.
// The skill prescribes concrete argument defaults: you-search(count=30), you-contents with 1-3
// URLs, formats: ["markdown"]. Aggregate the actual argument distributions across every started
// you-search / you-contents call to see how closely the model followed the prescribed defaults.
const sql = `
SELECT
  countIf(name = 'you-search') AS search_calls,
  round(avgIf(countVal, name = 'you-search'), 2) AS avg_search_count,
  countIf(name = 'you-search' AND countVal = 30) AS search_count_eq_30,
  countIf(name = 'you-search' AND countVal < 30) AS search_count_under_30,
  countIf(name = 'you-search' AND countVal > 30) AS search_count_over_30,
  countIf(name = 'you-contents') AS contents_calls,
  round(avgIf(urlsCount, name = 'you-contents'), 2) AS avg_urls_per_call,
  countIf(name = 'you-contents' AND urlsCount BETWEEN 1 AND 3) AS contents_1_to_3_urls,
  countIf(name = 'you-contents' AND urlsCount > 3) AS contents_over_3_urls,
  countIf(name = 'you-contents' AND usesMarkdown) AS contents_markdown
FROM (
  SELECT
    JSONExtractString(event, 'name') AS name,
    JSONExtractInt(event, 'input', 'count') AS countVal,
    length(JSONExtractArrayRaw(event, 'input', 'urls')) AS urlsCount,
    arrayExists(f -> positionCaseInsensitive(f, 'markdown') > 0, JSONExtractArrayRaw(event, 'input', 'formats')) AS usesMarkdown
  FROM ${tables.graded}
  ARRAY JOIN JSONExtractArrayRaw(json, 'trial', 'trajectory') AS event
  WHERE JSONExtractString(event, 'type') = 'tool_call'
    AND JSONExtractString(event, 'status') = 'started'
    AND JSONExtractString(event, 'name') IN ('you-search', 'you-contents')
)
FORMAT PrettyCompact`.trim()

export async function run(): Promise<string> {
  return section({
    title: '3. Tool-call parameter compliance',
    question:
      'The skill prescribes concrete argument defaults: you-search(count=30), you-contents with 1-3 URLs, formats: ["markdown"]. How closely did the model actually follow these defaults across every started search and contents call?',
    sql,
    output: await runSql(sql),
  })
}

if (import.meta.main) await process.stdout.write(await run())
