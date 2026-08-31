import { runSql, tables } from './lib.ts'

// ── Shared inner: per-trial arrays ──────────────────────────────────────────
// events: trajectory event objects. asstCum: per-position cumulative assistant-
// message count (i.e. which assistant "turn" emitted each event, 1-based).
// maxAsstCum: total number of assistant turns in the trial.
const eventsInner = `
  SELECT json, events,
    arrayCumSum(arrayMap(e -> if(JSONExtractString(e, 'type') = 'message' AND JSONExtractString(e, 'role') = 'assistant', 1, 0), events)) AS asstCum,
    arrayMax(arrayCumSum(arrayMap(e -> if(JSONExtractString(e, 'type') = 'message' AND JSONExtractString(e, 'role') = 'assistant', 1, 0), events))) AS maxAsstCum
  FROM (
    SELECT json, JSONExtractArrayRaw(json, 'trial', 'trajectory') AS events
    FROM ${tables.graded}
  )
`.trim()

// ── Reusable per-trial trial-level columns ──────────────────────────────────
const trialCols = `
  JSONExtractString(json, 'taskId') AS taskId,
  JSONExtractInt(json, 'trialIndex') AS trialIndex,
  JSONExtractFloat(json, 'score') AS score,
  JSONExtractBool(json, 'pass') AS pass,
  JSONExtractBool(json, 'trial', 'task', 'metadata', 'gradable') AS gradable
`.trim()

// ============================================================================
// 1a. Search-to-read coupling — overall PASS vs FAIL
// ============================================================================
// Each "round" = one asstCum value with ≥1 you-search or you-contents (started).
// coupled  = hasSearch AND hasRead  (search then read in same turn)
// blind    = hasSearch AND NOT hasRead  (search without reading)
// just_read = NOT hasSearch AND hasRead  (read without searching this turn)
const sql1a = `
SELECT
  if(pass, 'PASS', 'FAIL') AS result,
  count() AS trials,
  round(avg(coupled), 2) AS avg_coupled,
  round(avg(blind), 2) AS avg_blind,
  round(avg(just_read), 2) AS avg_just_read,
  round(avg(search_rounds), 2) AS avg_search_rounds,
  round(avg(active_rounds), 2) AS avg_active_rounds,
  round(avg(maxAsstCum), 2) AS avg_total_rounds,
  round(sum(coupled) / greatest(sum(search_rounds), 1), 4) AS pct_coupled,
  round(sum(blind) / greatest(sum(search_rounds), 1), 4) AS pct_blind,
  round(sum(just_read) / greatest(sum(maxAsstCum), 1), 4) AS pct_just_read
FROM (
  SELECT
    pass, taskId, trialIndex, maxAsstCum,
    countIf(hasSearch = 1 AND hasRead = 1) AS coupled,
    countIf(hasSearch = 1 AND hasRead = 0) AS blind,
    countIf(hasSearch = 0 AND hasRead = 1) AS just_read,
    countIf(hasSearch = 1) AS search_rounds,
    count() AS active_rounds
  FROM (
    SELECT
      ${trialCols},
      asstCumVal,
      maxAsstCum,
      max(if(JSONExtractString(event, 'type') = 'tool_call' AND JSONExtractString(event, 'name') = 'you-search' AND JSONExtractString(event, 'status') = 'started', 1, 0)) AS hasSearch,
      max(if(JSONExtractString(event, 'type') = 'tool_call' AND JSONExtractString(event, 'name') = 'you-contents' AND JSONExtractString(event, 'status') = 'started', 1, 0)) AS hasRead
    FROM (${eventsInner})
    ARRAY JOIN events AS event, asstCum AS asstCumVal
    WHERE asstCumVal > 0
      AND JSONExtractString(event, 'type') = 'tool_call'
      AND JSONExtractString(event, 'name') IN ('you-search', 'you-contents')
      AND JSONExtractString(event, 'status') = 'started'
    GROUP BY taskId, trialIndex, score, pass, gradable, maxAsstCum, asstCumVal
  )
  WHERE gradable
  GROUP BY pass, taskId, trialIndex, maxAsstCum
)
GROUP BY result
ORDER BY result ASC
FORMAT PrettyCompact`.trim()

// ============================================================================
// 1b. Coupling by search-round band — does coupling drop in later rounds?
// ============================================================================
// Group trials by their total search-round count, then within each band compute
// the coupling rate. Split by pass/fail to see if failures degrade differently.
const sql1b = `
SELECT
  if(pass, 'PASS', 'FAIL') AS result,
  multiIf(search_rounds = 1, '1 round', search_rounds = 2, '2 rounds', search_rounds = 3, '3 rounds', '4+ rounds') AS search_band,
  count() AS trials,
  round(avg(coupled), 2) AS avg_coupled,
  round(avg(blind), 2) AS avg_blind,
  round(avg(just_read), 2) AS avg_just_read,
  round(avg(search_rounds), 2) AS avg_search_rounds,
  round(sum(coupled) / greatest(sum(search_rounds), 1), 4) AS pct_coupled,
  round(sum(blind) / greatest(sum(search_rounds), 1), 4) AS pct_blind
FROM (
  SELECT
    pass, taskId, trialIndex,
    countIf(hasSearch = 1 AND hasRead = 1) AS coupled,
    countIf(hasSearch = 1 AND hasRead = 0) AS blind,
    countIf(hasSearch = 0 AND hasRead = 1) AS just_read,
    countIf(hasSearch = 1) AS search_rounds
  FROM (
    SELECT
      ${trialCols},
      asstCumVal,
      max(if(JSONExtractString(event, 'type') = 'tool_call' AND JSONExtractString(event, 'name') = 'you-search' AND JSONExtractString(event, 'status') = 'started', 1, 0)) AS hasSearch,
      max(if(JSONExtractString(event, 'type') = 'tool_call' AND JSONExtractString(event, 'name') = 'you-contents' AND JSONExtractString(event, 'status') = 'started', 1, 0)) AS hasRead
    FROM (${eventsInner})
    ARRAY JOIN events AS event, asstCum AS asstCumVal
    WHERE asstCumVal > 0
      AND JSONExtractString(event, 'type') = 'tool_call'
      AND JSONExtractString(event, 'name') IN ('you-search', 'you-contents')
      AND JSONExtractString(event, 'status') = 'started'
    GROUP BY taskId, trialIndex, score, pass, gradable, asstCumVal
  )
  WHERE gradable
  GROUP BY pass, taskId, trialIndex
)
GROUP BY result, search_band
ORDER BY result ASC, search_band ASC
FORMAT PrettyCompact`.trim()

// ============================================================================
// 2. Parallelism — rounds with 2+ parallel you-search calls
// ============================================================================
// Per round that has searches, count distinct you-search(started) events.
// Parallel round = 2+ searches in the same assistant turn.
const sql2 = `
SELECT
  if(pass, 'PASS', 'FAIL') AS result,
  count() AS trials,
  round(avg(parallel_rounds), 2) AS avg_parallel_rounds,
  round(avg(search_rounds), 2) AS avg_search_rounds,
  round(sum(parallel_rounds) / greatest(sum(search_rounds), 1), 4) AS pct_parallel,
  round(avg(avg_searches_per_round), 2) AS avg_searches_per_round,
  round(avg(max_searches_in_round), 2) AS avg_max_searches_in_round
FROM (
  SELECT
    pass, taskId, trialIndex,
    countIf(search_count >= 2) AS parallel_rounds,
    count() AS search_rounds,
    avg(search_count) AS avg_searches_per_round,
    max(search_count) AS max_searches_in_round
  FROM (
    SELECT
      ${trialCols},
      asstCumVal,
      count() AS search_count
    FROM (${eventsInner})
    ARRAY JOIN events AS event, asstCum AS asstCumVal
    WHERE asstCumVal > 0
      AND JSONExtractString(event, 'type') = 'tool_call'
      AND JSONExtractString(event, 'name') = 'you-search'
      AND JSONExtractString(event, 'status') = 'started'
    GROUP BY taskId, trialIndex, score, pass, gradable, asstCumVal
  )
  WHERE gradable
  GROUP BY pass, taskId, trialIndex
)
GROUP BY result
ORDER BY result ASC
FORMAT PrettyCompact`.trim()

// ============================================================================
// 2b. Parallelism by search-round band
// ============================================================================
const sql2b = `
SELECT
  if(pass, 'PASS', 'FAIL') AS result,
  multiIf(search_rounds = 1, '1 round', search_rounds = 2, '2 rounds', search_rounds = 3, '3 rounds', '4+ rounds') AS search_band,
  count() AS trials,
  round(avg(parallel_rounds), 2) AS avg_parallel_rounds,
  round(sum(parallel_rounds) / greatest(sum(search_rounds), 1), 4) AS pct_parallel
FROM (
  SELECT
    pass, taskId, trialIndex,
    countIf(search_count >= 2) AS parallel_rounds,
    count() AS search_rounds
  FROM (
    SELECT
      ${trialCols},
      asstCumVal,
      count() AS search_count
    FROM (${eventsInner})
    ARRAY JOIN events AS event, asstCum AS asstCumVal
    WHERE asstCumVal > 0
      AND JSONExtractString(event, 'type') = 'tool_call'
      AND JSONExtractString(event, 'name') = 'you-search'
      AND JSONExtractString(event, 'status') = 'started'
    GROUP BY taskId, trialIndex, score, pass, gradable, asstCumVal
  )
  WHERE gradable
  GROUP BY pass, taskId, trialIndex
)
GROUP BY result, search_band
ORDER BY result ASC, search_band ASC
FORMAT PrettyCompact`.trim()

// ============================================================================
// 3. First-round behavior
// ============================================================================
// For each trial find the first assistant round that issued a search, then
// count how many searches and reads happened in that round. Compare PASS vs FAIL.
// Uses a JOIN to find the first search round instead of arrayEnumerate + events[i]
// (which would duplicate large event arrays and blow memory on an 8 GB file).
const sql3 = `
SELECT
  if(pass, 'PASS', 'FAIL') AS result,
  count() AS trials,
  round(avg(r1_searches), 2) AS avg_r1_searches,
  round(avg(r1_reads), 2) AS avg_r1_reads,
  round(countIf(r1_reads > 0) / count(), 4) AS pct_has_read_in_r1,
  round(countIf(r1_searches = 1) / count(), 4) AS pct_single_search_r1,
  round(countIf(r1_searches >= 3) / count(), 4) AS pct_many_searches_r1,
  round(countIf(r1_searches <= 2 AND r1_reads > 0) / count(), 4) AS pct_focused_with_read_r1
FROM (
  SELECT
    e.pass, e.taskId, e.trialIndex, e.gradable,
    countIf(JSONExtractString(e.event, 'name') = 'you-search') AS r1_searches,
    countIf(JSONExtractString(e.event, 'name') = 'you-contents') AS r1_reads
  FROM (
    SELECT
      ${trialCols},
      asstCumVal,
      event
    FROM (${eventsInner})
    ARRAY JOIN events AS event, asstCum AS asstCumVal
    WHERE asstCumVal > 0
      AND JSONExtractString(event, 'type') = 'tool_call'
      AND JSONExtractString(event, 'name') IN ('you-search', 'you-contents')
      AND JSONExtractString(event, 'status') = 'started'
  ) e
  INNER JOIN (
    SELECT taskId, trialIndex, min(asstCumVal) AS firstSearchRound
    FROM (
      SELECT
        JSONExtractString(json, 'taskId') AS taskId,
        JSONExtractInt(json, 'trialIndex') AS trialIndex,
        asstCumVal
      FROM (${eventsInner})
      ARRAY JOIN events AS event, asstCum AS asstCumVal
      WHERE asstCumVal > 0
        AND JSONExtractString(event, 'type') = 'tool_call'
        AND JSONExtractString(event, 'name') = 'you-search'
        AND JSONExtractString(event, 'status') = 'started'
    )
    GROUP BY taskId, trialIndex
  ) fr ON e.taskId = fr.taskId AND e.trialIndex = fr.trialIndex AND e.asstCumVal = fr.firstSearchRound
  WHERE e.gradable
  GROUP BY e.pass, e.taskId, e.trialIndex, e.gradable
)
GROUP BY result
ORDER BY result ASC
FORMAT PrettyCompact`.trim()

// ============================================================================
// 4. Read depth by round — early (1-2) vs late (3+)
// ============================================================================
// For trials with 3+ assistant rounds, measure avg URLs per you-contents call
// in early rounds vs late rounds. Does the model get more selective or more
// desperate? Split by pass/fail.
const sql4 = `
SELECT
  if(pass, 'PASS', 'FAIL') AS result,
  multiIf(asstCumVal <= 2, 'Early (1-2)', 'Late (3+)') AS round_band,
  count() AS read_calls,
  count(DISTINCT taskId, trialIndex) AS trials,
  round(avg(url_count), 2) AS avg_urls_per_read,
  round(quantile(0.5)(url_count), 2) AS median_urls_per_read,
  round(quantile(0.9)(url_count), 2) AS p90_urls_per_read,
  round(countIf(url_count > 1) / count(), 4) AS pct_multi_url_read,
  round(avgIf(url_count, url_count > 1), 2) AS avg_urls_when_multi
FROM (
  SELECT
    pass, taskId, trialIndex, gradable,
    asstCumVal,
    length(JSONExtractArrayRaw(event, 'input', 'urls')) AS url_count
  FROM (
    SELECT ${trialCols}, events, asstCum, maxAsstCum
    FROM (${eventsInner})
    WHERE maxAsstCum >= 3
  )
  ARRAY JOIN events AS event, asstCum AS asstCumVal
  WHERE JSONExtractString(event, 'type') = 'tool_call'
    AND JSONExtractString(event, 'name') = 'you-contents'
    AND JSONExtractString(event, 'status') = 'started'
)
WHERE gradable
GROUP BY result, round_band
ORDER BY result ASC, round_band ASC
FORMAT PrettyCompact`.trim()

// ── Rendering ────────────────────────────────────────────────────────────────

function block(label: string, sql: string, out: string): string {
  const fence = '```'
  const text = out.endsWith('\n') ? out : `${out}\n`
  return `${label}\n\n${fence}sql\n${sql}\n${fence}\n\n${fence}text\n${text}${fence}\n\n`
}

export async function run(): Promise<string> {
  // Run sequentially to keep memory low — each query materialises per-trial arrays
  // from an 8 GB graded.jsonl, and 6 concurrent copies would exceed available RAM.
  const out1a = await runSql(sql1a)
  const out1b = await runSql(sql1b)
  const out2 = await runSql(sql2)
  const out2b = await runSql(sql2b)
  const out3 = await runSql(sql3)
  const out4 = await runSql(sql4)

  const intro = `## 6c. Search-to-read coupling and error timing

Four analyses of how the model pairs you-search with you-contents across assistant turns, to identify patterns that distinguish PASS from FAIL trials.

**Hypotheses tested:**
1. FAIL trials have more search-only (blind) rounds, especially in later rounds.
2. PASS trials use more parallel searches per round (broader exploration).
3. FAIL trials are either unfocused (too many searches) or too narrow (too few, no read) in round 1.
4. FAIL trials get less selective in later rounds (more URLs per read, "grabbing at straws").
`

  const body =
    block('1a. Search-to-read coupling — overall PASS vs FAIL', sql1a, out1a) +
    block('1b. Coupling by search-round band — does coupling drop for multi-round failures?', sql1b, out1b) +
    block('2a. Parallel search rounds — PASS vs FAIL', sql2, out2) +
    block('2b. Parallelism by search-round band', sql2b, out2b) +
    block('3. First-round behavior', sql3, out3) +
    block('4. Read depth by round (early vs late), trials with 3+ rounds only', sql4, out4)

  return `${intro}\n${body}`
}

if (import.meta.main) await process.stdout.write(await run())
