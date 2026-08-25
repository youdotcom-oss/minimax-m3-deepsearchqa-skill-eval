import { runSql, tables } from './lib.ts'

// Direction 6: query evolution, read repetition, and final answer quality.
// Runs over data/graded.jsonl trial.trajectory.
// Three sub-analyses:
//  1. Query evolution across rounds (trials with 3+ search rounds): first vs last you-search
//     query length, specificity, common prefix, round span.
//  2. Read repetition: total you-contents calls vs distinct URLs read (array-function approach
//     avoids ARRAY JOIN row explosion).
//  3. Final answer quality: last assistant message length, section headers, citation count.
//
// Queries run sequentially to avoid memory contention over the 8GB graded.jsonl.

const MEMORY = 'SETTINGS max_memory_usage = 40000000000'

// Shared inner: per-trial events, asstCum, isSearch — used by query 1.
const eventsInner = `
SELECT json, events,
  arrayCumSum(arrayMap(e -> if(JSONExtractString(e, 'type') = 'message' AND JSONExtractString(e, 'role') = 'assistant', 1, 0), events)) AS asstCum,
  arrayMap(e -> if(JSONExtractString(e, 'type') = 'tool_call' AND JSONExtractString(e, 'name') = 'you-search' AND JSONExtractString(e, 'status') = 'started', 1, 0), events) AS isSearch
FROM (
  SELECT json, JSONExtractArrayRaw(json, 'trial', 'trajectory') AS events
  FROM ${tables.graded}
)`.trim()

// Shared inner: per-trial totalReads + distinctUrls via array functions — used by queries 2a/2b.
// Computes read stats in one pass without ARRAY JOIN, bounding memory per trial.
const readsInner = `
SELECT
  json,
  arraySum(arrayMap(e -> length(JSONExtractArrayRaw(e, 'input', 'urls')),
    arrayFilter(e -> JSONExtractString(e, 'type') = 'tool_call'
      AND JSONExtractString(e, 'name') = 'you-contents'
      AND JSONExtractString(e, 'status') = 'started',
      JSONExtractArrayRaw(json, 'trial', 'trajectory')))) AS totalReads,
  length(arrayDistinct(
    arrayFlatten(
      arrayMap(e -> arrayMap(u -> JSONExtractString(u), JSONExtractArrayRaw(e, 'input', 'urls')),
        arrayFilter(e -> JSONExtractString(e, 'type') = 'tool_call'
          AND JSONExtractString(e, 'name') = 'you-contents'
          AND JSONExtractString(e, 'status') = 'started',
          JSONExtractArrayRaw(json, 'trial', 'trajectory')))
    )
  )) AS distinctUrls
FROM ${tables.graded}`.trim()

// ---------------------------------------------------------------------------
// Query 1: Query evolution across rounds (trials with 3+ search rounds)
// ---------------------------------------------------------------------------
const sql1 = `
SELECT
  if(pass, 'PASS', 'FAIL') AS outcome,
  count() AS trials,
  round(avg(firstLen), 1) AS avg_first_len,
  round(avg(lastLen), 1) AS avg_last_len,
  round(avg(lastLen - firstLen), 1) AS avg_len_change,
  round(avg(roundSpan), 2) AS avg_round_span,
  round(countIf(lastLen < firstLen) / count(), 4) AS pct_shorter_last,
  round(countIf(hasCommonPrefix50) / count(), 4) AS pct_common_prefix_50,
  round(countIf(hasCommonPrefix25) / count(), 4) AS pct_common_prefix_25,
  round(countIf(lastLen > firstLen * 1.5) / count(), 4) AS pct_last_much_longer
FROM (
  SELECT
    pass,
    length(firstQuery) AS firstLen,
    length(lastQuery) AS lastLen,
    lastRound - firstRound AS roundSpan,
    firstQuery != '' AND lastQuery != '' AND substring(firstQuery, 1, 50) = substring(lastQuery, 1, 50) AS hasCommonPrefix50,
    firstQuery != '' AND lastQuery != '' AND substring(firstQuery, 1, 25) = substring(lastQuery, 1, 25) AS hasCommonPrefix25
  FROM (
    SELECT
      JSONExtractBool(json, 'pass') AS pass,
      JSONExtractBool(json, 'trial', 'task', 'metadata', 'gradable') AS gradable,
      JSONExtractString(searchEvents[1], 'input', 'query') AS firstQuery,
      JSONExtractString(searchEvents[-1], 'input', 'query') AS lastQuery,
      tupleElement(searchRoundTuples[1], 1) AS firstRound,
      tupleElement(searchRoundTuples[-1], 1) AS lastRound
    FROM (
      SELECT
        json, pass, gradable,
        arrayFilter(e -> JSONExtractString(e, 'type') = 'tool_call' AND JSONExtractString(e, 'name') = 'you-search' AND JSONExtractString(e, 'status') = 'started', events) AS searchEvents,
        arrayFilter(t -> tupleElement(t, 2) = 1, arrayZip(asstCum, isSearch)) AS searchRoundTuples,
        length(arrayDistinct(arrayMap(t -> tupleElement(t, 1), arrayFilter(t -> tupleElement(t, 2) = 1, arrayZip(asstCum, isSearch))))) AS numSearchRounds
      FROM (
        SELECT json,
          JSONExtractBool(json, 'pass') AS pass,
          JSONExtractBool(json, 'trial', 'task', 'metadata', 'gradable') AS gradable,
          events, asstCum, isSearch
        FROM (${eventsInner})
      )
    )
    WHERE gradable AND numSearchRounds >= 3
  )
  WHERE firstQuery != '' AND lastQuery != ''
)
GROUP BY outcome
ORDER BY outcome ASC
FORMAT PrettyCompact
${MEMORY}`.trim()

// ---------------------------------------------------------------------------
// Query 2a: Read repetition — aggregate by pass/fail
// ---------------------------------------------------------------------------
const sql2a = `
SELECT
  if(pass, 'PASS', 'FAIL') AS outcome,
  count() AS trials,
  round(avg(distinctUrls), 1) AS avg_distinct_urls,
  round(avg(totalReads), 1) AS avg_total_reads,
  round(avg(totalReads / greatest(distinctUrls, 1)), 3) AS avg_repetition_ratio,
  round(countIf(totalReads / greatest(distinctUrls, 1) > 1.5) / count(), 4) AS pct_heavy_reread,
  round(avg(if(totalReads / greatest(distinctUrls, 1) > 1.5, totalReads / greatest(distinctUrls, 1), NULL)), 3) AS avg_ratio_when_heavy
FROM (
  SELECT
    JSONExtractBool(json, 'pass') AS pass,
    JSONExtractBool(json, 'trial', 'task', 'metadata', 'gradable') AS gradable,
    totalReads,
    distinctUrls
  FROM (${readsInner})
  WHERE gradable AND totalReads > 0
)
GROUP BY outcome
ORDER BY outcome ASC
FORMAT PrettyCompact`.trim()

// ---------------------------------------------------------------------------
// Query 2b: Read repetition — bucketed by read count × pass/fail
// ---------------------------------------------------------------------------
const sql2b = `
SELECT
  multiIf(totalReads <= 2, '1-2 reads', totalReads <= 5, '3-5 reads', totalReads <= 10, '6-10 reads', '11+ reads') AS read_band,
  if(pass, 'PASS', 'FAIL') AS outcome,
  count() AS trials,
  round(avg(distinctUrls), 1) AS avg_distinct_urls,
  round(avg(totalReads / greatest(distinctUrls, 1)), 3) AS avg_repetition_ratio,
  round(countIf(totalReads / greatest(distinctUrls, 1) > 1.5) / count(), 4) AS pct_heavy_reread
FROM (
  SELECT
    JSONExtractBool(json, 'pass') AS pass,
    JSONExtractBool(json, 'trial', 'task', 'metadata', 'gradable') AS gradable,
    totalReads,
    distinctUrls
  FROM (${readsInner})
  WHERE gradable AND totalReads > 0
)
GROUP BY read_band, outcome
ORDER BY read_band ASC, outcome ASC
FORMAT PrettyCompact`.trim()

// ---------------------------------------------------------------------------
// Query 3: Final answer quality markers
// ---------------------------------------------------------------------------
const sql3 = `
SELECT
  if(pass, 'PASS', 'FAIL') AS outcome,
  count() AS trials,
  round(avg(charLength), 0) AS avg_char_length,
  countIf(charLength < 500) AS trials_under_500_chars,
  round(countIf(hasAnswer) / count(), 4) AS pct_answer_section,
  round(countIf(hasEvidence) / count(), 4) AS pct_evidence_section,
  round(countIf(hasSources) / count(), 4) AS pct_sources_section,
  round(countIf(hasAnswer AND hasEvidence AND hasSources) / count(), 4) AS pct_all_three,
  round(avg(citationCount), 1) AS avg_citations,
  round(countIf(citationCount = 0) / count(), 4) AS pct_zero_citations
FROM (
  SELECT
    JSONExtractBool(json, 'pass') AS pass,
    JSONExtractBool(json, 'trial', 'task', 'metadata', 'gradable') AS gradable,
    length(content) AS charLength,
    positionCaseInsensitive(content, '## Answer') > 0 AS hasAnswer,
    positionCaseInsensitive(content, '## Evidence') > 0 AS hasEvidence,
    positionCaseInsensitive(content, '## Sources') > 0 AS hasSources,
    length(extractAll(content, 'https?://[0-9A-Za-z./_:?=&%~+#-]+')) AS citationCount
  FROM (
    SELECT
      json,
      JSONExtractString(
        arrayFilter(
          e -> JSONExtractString(e, 'type') = 'message'
            AND JSONExtractString(e, 'role') = 'assistant',
          JSONExtractArrayRaw(json, 'trial', 'trajectory')
        )[-1],
        'content'
      ) AS content
    FROM ${tables.graded}
  )
  WHERE gradable AND content != ''
)
GROUP BY outcome
ORDER BY outcome ASC
FORMAT PrettyCompact`.trim()

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------
function block(label: string, sql: string, out: string): string {
  const fence = '```'
  const text = out.endsWith('\n') ? out : `${out}\n`
  return `${label}\n\n${fence}sql\n${sql}\n${fence}\n\n${fence}text\n${text}${fence}\n\n`
}

// ---------------------------------------------------------------------------
// Run — sequential to avoid memory contention with the 8GB graded.jsonl
// ---------------------------------------------------------------------------
export async function run(): Promise<string> {
  // Run sequentially — each query scans the full 8GB file and parallel execution
  // risks OOM on systems with <64GB RAM.
  const out1 = await runSql(sql1)
  const out2a = await runSql(sql2a)
  const out2b = await runSql(sql2b)
  const out3 = await runSql(sql3)

  const intro = `## 6b. Query evolution, read repetition, and final answer quality

Three sub-analyses probing trajectory-level patterns that may distinguish PASS from FAIL trials.`

  const q1 = `### 6a. Query evolution across rounds

For trials with 3+ search rounds, compare the first you-search query to the last. Metrics: average character length (first vs last), length change, whether the last query is shorter than the first (degradation), whether the first and last share a common 50- or 25-character prefix (refocus vs drift), and the round span between them. Hypothesis: FAIL trials show query degradation (shorter last queries, less specificity) over more rounds.`

  const q2 = `### 6b. Read repetition

Per trial, count total URLs submitted to you-contents (sum of input.urls array lengths) and distinct URLs read. Repetition ratio = total / distinct (1.0 = no repetition, >1 = some URLs re-read). Shown as aggregate PASS/FAIL split and bucketed by read count. Hypothesis: FAIL trials re-read the same URLs more, suggesting they get stuck on unhelpful pages.`

  const q3 = `### 6c. Final answer quality markers

Extract the last assistant message per trial and measure: character length, presence of Answer/Evidence/Sources section headers (the skill-mandated structure), and citation URL count. Hypothesis: FAIL trials produce shorter, less structured final answers with fewer citations.`

  return [
    intro,
    '',
    q1,
    '',
    block('Query 1 — query evolution (trials with 3+ search rounds):', sql1, out1),
    q2,
    '',
    block('Query 2a — read repetition by pass/fail:', sql2a, out2a),
    block('Query 2b — read repetition bucketed by read count × pass/fail:', sql2b, out2b),
    q3,
    '',
    block('Query 3 — final answer quality markers:', sql3, out3),
  ].join('\n')
}

if (import.meta.main) await process.stdout.write(await run())
