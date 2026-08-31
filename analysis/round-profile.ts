import { runSql, tables } from './lib.ts'

// Direction: Round profiles and termination patterns. Runs over data/graded.jsonl trial.trajectory.
// Measures three dimensions across PASS vs FAIL trials:
//   1. Assistant message depth by round — does reasoning shrink in later rounds / final answer?
//   2. Round-by-round search and read evolution — do FAIL trials escalate while PASS stays flat?
//   3. Termination patterns — do FAIL trials stop searching without recent reads?

// --- Shared base CTE for queries 2 and 3 (needs isSearch + isRead) ---
const baseToolCTE = `
WITH base AS (
  SELECT
    JSONExtractBool(json, 'pass') AS pass,
    JSONExtractString(json, 'taskId') AS taskId,
    JSONExtractInt(json, 'trialIndex') AS trialIndex,
    events,
    arrayCumSum(arrayMap(e -> if(JSONExtractString(e, 'type') = 'message' AND JSONExtractString(e, 'role') = 'assistant', 1, 0), events)) AS asstCum,
    arrayMap(e -> if(JSONExtractString(e, 'type') = 'tool_call' AND JSONExtractString(e, 'name') = 'you-search' AND JSONExtractString(e, 'status') = 'started', 1, 0), events) AS isSearch,
    arrayMap(e -> if(JSONExtractString(e, 'type') = 'tool_call' AND JSONExtractString(e, 'name') = 'you-contents' AND JSONExtractString(e, 'status') = 'started', 1, 0), events) AS isRead
  FROM (
    SELECT json, JSONExtractArrayRaw(json, 'trial', 'trajectory') AS events
    FROM ${tables.graded}
  )
)`.trim()

// ===========================================================================
// Query 1a: Assistant message content length by round band × pass/fail
// ===========================================================================
const sql1a = `
WITH base AS (
  SELECT
    JSONExtractBool(json, 'pass') AS pass,
    events,
    arrayCumSum(arrayMap(e -> if(JSONExtractString(e, 'type') = 'message' AND JSONExtractString(e, 'role') = 'assistant', 1, 0), events)) AS asstCum
  FROM (
    SELECT json, JSONExtractArrayRaw(json, 'trial', 'trajectory') AS events
    FROM ${tables.graded}
  )
)
SELECT
  multiIf(rnd = 1, '1', rnd = 2, '2', rnd = 3, '3', rnd = 4, '4', '5+') AS round_band,
  pass,
  count() AS messages,
  round(avg(length(JSONExtractString(event, 'content'))), 2) AS avg_content_len,
  round(countIf(length(JSONExtractString(event, 'content')) < 50) / count(), 4) AS pct_short
FROM base
ARRAY JOIN events AS event, asstCum AS rnd
WHERE JSONExtractString(event, 'type') = 'message'
  AND JSONExtractString(event, 'role') = 'assistant'
  AND JSONExtractString(event, 'content') != ''
  AND rnd > 0
GROUP BY round_band, pass
ORDER BY round_band ASC, pass ASC
FORMAT PrettyCompact`.trim()

// ===========================================================================
// Query 1b: Final assistant message content length × pass/fail
// ===========================================================================
const sql1b = `
WITH base AS (
  SELECT
    JSONExtractBool(json, 'pass') AS pass,
    events,
    arrayCumSum(arrayMap(e -> if(JSONExtractString(e, 'type') = 'message' AND JSONExtractString(e, 'role') = 'assistant', 1, 0), events)) AS asstCum
  FROM (
    SELECT json, JSONExtractArrayRaw(json, 'trial', 'trajectory') AS events
    FROM ${tables.graded}
  )
)
SELECT
  pass,
  count() AS trials,
  round(avg(length(finalContent)), 2) AS avg_final_content_len,
  round(countIf(length(finalContent) < 100) / count(), 4) AS pct_final_short
FROM (
  SELECT
    pass,
    arrayFilter(e -> JSONExtractString(e, 'type') = 'message' AND JSONExtractString(e, 'role') = 'assistant', events) AS asstMsgs,
    JSONExtractString(arrayElement(asstMsgs, length(asstMsgs)), 'content') AS finalContent
  FROM base
)
WHERE length(finalContent) > 0
GROUP BY pass
ORDER BY pass ASC
FORMAT PrettyCompact`.trim()

// ===========================================================================
// Query 2: Round-by-round search and read evolution
// ===========================================================================
const sql2 = `
${baseToolCTE},
per_round AS (
  SELECT pass, taskId, trialIndex, rnd,
    countIf(JSONExtractString(event, 'type') = 'tool_call' AND JSONExtractString(event, 'name') = 'you-search' AND JSONExtractString(event, 'status') = 'started') AS searches,
    countIf(JSONExtractString(event, 'type') = 'tool_call' AND JSONExtractString(event, 'name') = 'you-contents' AND JSONExtractString(event, 'status') = 'started') AS reads
  FROM base
  ARRAY JOIN events AS event, asstCum AS rnd
  WHERE rnd > 0
  GROUP BY pass, taskId, trialIndex, rnd
)
SELECT
  multiIf(rnd = 1, '1', rnd = 2, '2', rnd = 3, '3', rnd = 4, '4', '5+') AS round_band,
  pass,
  count() AS trial_rounds,
  round(avg(searches), 2) AS avg_searches,
  round(avg(reads), 2) AS avg_reads,
  round(countIf(reads > 0) / count(), 4) AS pct_with_any_read
FROM per_round
GROUP BY round_band, pass
ORDER BY round_band ASC, pass ASC
FORMAT PrettyCompact`.trim()

// ===========================================================================
// Query 3: Termination patterns — final round behavior
// ===========================================================================
const sql3 = `
${baseToolCTE},
trial_stats AS (
  SELECT pass,
    arraySum(isSearch) AS totalSearches,
    arraySum(isRead) AS totalReads,
    arraySort(arrayDistinct(arrayFilter((r, s) -> s = 1, asstCum, isSearch))) AS srchRounds,
    arraySort(arrayDistinct(arrayFilter((r, s) -> s = 1, asstCum, isRead))) AS readRounds,
    events,
    asstCum
  FROM base
  WHERE arraySum(isSearch) > 0
),
computed AS (
  SELECT pass,
    totalSearches,
    totalReads,
    srchRounds,
    readRounds,
    srchRounds[length(srchRounds)] AS lastSrch,
    if(length(readRounds) > 0, readRounds[length(readRounds)], 0) AS lastRead,
    srchRounds[length(srchRounds)] - if(length(readRounds) > 0, readRounds[length(readRounds)], 0) AS gap,
    if(length(srchRounds) >= 2, srchRounds[length(srchRounds) - 1], srchRounds[length(srchRounds)]) AS secondLastSrch,
    arraySum(arrayMap((e, r) -> if(
      r = srchRounds[length(srchRounds)] AND
      JSONExtractString(e, 'type') = 'tool_call' AND
      JSONExtractString(e, 'name') = 'you-contents' AND
      JSONExtractString(e, 'status') = 'started', 1, 0),
      events, asstCum)) AS readsInFinalSrch,
    arraySum(arrayMap((e, r) -> if(
      (r = srchRounds[length(srchRounds)] OR r = if(length(srchRounds) >= 2, srchRounds[length(srchRounds) - 1], srchRounds[length(srchRounds)])) AND
      JSONExtractString(e, 'type') = 'tool_call' AND
      JSONExtractString(e, 'name') = 'you-contents' AND
      JSONExtractString(e, 'status') = 'started', 1, 0),
      events, asstCum)) AS readsInLast2Srch
  FROM trial_stats
)
SELECT
  pass,
  count() AS trials,
  round(avg(totalSearches), 2) AS avg_total_searches,
  round(avg(totalReads), 2) AS avg_total_reads,
  round(avg(readsInFinalSrch), 2) AS avg_reads_in_final_search_round,
  round(avg(readsInLast2Srch), 2) AS avg_reads_in_last_2_search_rounds,
  round(countIf(totalReads = 0) / count(), 4) AS pct_zero_total_reads,
  round(avg(gap), 2) AS avg_gap_last_search_to_last_read,
  round(avg(lastSrch), 2) AS avg_last_search_round,
  round(avg(lastRead), 2) AS avg_last_read_round
FROM computed
GROUP BY pass
ORDER BY pass ASC
FORMAT PrettyCompact`.trim()

// ===========================================================================
// Helpers
// ===========================================================================
function block(label: string, sql: string, out: string): string {
  const fence = '```'
  const text = out.endsWith('\n') ? out : `${out}\n`
  return `${label}\n\n${fence}sql\n${sql}\n${fence}\n\n${fence}text\n${text}${fence}\n\n`
}

// ===========================================================================
// Main run
// ===========================================================================
export async function run(): Promise<string> {
  const [out1a, out1b, out2, out3] = await Promise.all([runSql(sql1a), runSql(sql1b), runSql(sql2), runSql(sql3)])

  const intro =
    'Round profiles and termination patterns: how does trial behaviour evolve round-by-round, and how do final-round signals distinguish PASS from FAIL? Three dimensions: (1) assistant message content depth per round, testing whether reasoning shrinks in later rounds or in the final answer; (2) search and read intensity per round, testing whether FAIL profiles escalate while PASS stays flat; (3) termination behaviour — reads in the final search round(s), zero-read trials, and the gap between last read and last search.'

  const body =
    block('(1a) Assistant message content length by round band × pass/fail:', sql1a, out1a) +
    block('(1b) Final assistant message content length × pass/fail:', sql1b, out1b) +
    block('(2) Round-by-round search and read evolution × pass/fail:', sql2, out2) +
    block('(3) Termination patterns — final round reads, zero-read rate, read-search gap:', sql3, out3)

  return `## 6a. Round profiles & termination patterns\n\n${intro}\n\n${body}`
}

if (import.meta.main) await process.stdout.write(await run())
