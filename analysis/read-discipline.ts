import { runSql, section, tables } from './lib.ts'

// Direction 2: read discipline. Runs on the flat, fast data/results.jsonl.
// The skill insists snippets never count as reading and mandates at least one you-contents read
// before answering. Bucket gradable trials by contents-call count; the 0 band is a direct skill
// violation (snippet-only answering). Also reports the search-per-read ratio.
const sql = `
SELECT
  band AS contents_call_band,
  count() AS trials,
  round(avg(score), 4) AS avg_score,
  round(countIf(pass) / count(), 4) AS pass_rate,
  round(avg(searchCalls), 2) AS avg_search_calls,
  round(avg(searchPerRead), 2) AS avg_search_per_read
FROM (
  SELECT
    multiIf(
      contentsCalls = 0, '0 (snippet-only)',
      contentsCalls <= 2, '1-2',
      contentsCalls <= 5, '3-5',
      '6+'
    ) AS band,
    score, pass, searchCalls,
    searchCalls / greatest(contentsCalls, 1) AS searchPerRead
  FROM (
    SELECT
      JSONExtractInt(json, 'contentsCalls') AS contentsCalls,
      JSONExtractInt(json, 'searchCalls') AS searchCalls,
      JSONExtractFloat(json, 'score') AS score,
      JSONExtractBool(json, 'pass') AS pass,
      JSONExtractBool(json, 'gradable') AS gradable
    FROM ${tables.results}
  )
  WHERE gradable
)
GROUP BY band
ORDER BY band ASC
FORMAT PrettyCompact`.trim()

export async function run(): Promise<string> {
  return section({
    title: '2. Read discipline (search-to-contents ratio)',
    question:
      'The skill insists snippets never count as reading and mandates at least one you-contents read before answering. How many gradable trials answered with zero reads (a direct violation), and does reading more pages track with correctness? Bucket by contents-call count and report the search-per-read ratio.',
    sql,
    output: await runSql(sql),
  })
}

if (import.meta.main) await process.stdout.write(await run())
