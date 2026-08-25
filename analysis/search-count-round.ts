import { runSql, tables } from './lib.ts'

// Direction 3b (deeper dig into 3/3a). Runs over data/graded.jsonl trial.trajectory.
// 3a found the model specifies `count` on ~46% of searches but almost never uses the skill's
// count=30 (9 of 24,999). Two follow-ups:
//  (A) At which search round does the model set count, and does the rate/value change by round?
//      A "round" = the assistant turn that emitted the search, labeled by the cumulative count of
//      assistant messages preceding+including it (asstCum, reused from the inflight analysis).
//  (B) Does specifying count (or count=30) associate with score — or is any apparent effect just
//      the over-rounding confound (more rounds -> lower score)? B1 is the raw trial-level split;
//      B2 controls for search-round band so the count signal is isolated from round count.

// Per-trial arrays: events, asstCum (cumulative assistant-message count per position),
// isSearch (1 at each started you-search). Shared by all three queries.
const eventsInner = `
SELECT json, events,
  arrayCumSum(arrayMap(e -> if(JSONExtractString(e, 'type') = 'message' AND JSONExtractString(e, 'role') = 'assistant', 1, 0), events)) AS asstCum,
  arrayMap(e -> if(JSONExtractString(e, 'type') = 'tool_call' AND JSONExtractString(e, 'name') = 'you-search' AND JSONExtractString(e, 'status') = 'started', 1, 0), events) AS isSearch
FROM (
  SELECT json, JSONExtractArrayRaw(json, 'trial', 'trajectory') AS events
  FROM ${tables.graded}
)`.trim()

// (A) Per started you-search: its round (asstCum), whether count was specified, the value.
const sqlA = `
SELECT
  multiIf(rnd = 1, '1', rnd = 2, '2', rnd = 3, '3', rnd = 4, '4', '5+') AS round_band,
  count() AS searches,
  round(countIf(specified) / count(), 4) AS pct_specified,
  round(avgIf(cnt, specified), 2) AS avg_count_when_set,
  countIf(specified AND cnt = 30) AS specified_eq_30
FROM (
  SELECT asstCum AS rnd, JSONHas(event, 'input', 'count') AS specified, JSONExtractInt(event, 'input', 'count') AS cnt
  FROM (${eventsInner})
  ARRAY JOIN events AS event, asstCum
  WHERE JSONExtractString(event, 'type') = 'tool_call'
    AND JSONExtractString(event, 'name') = 'you-search'
    AND JSONExtractString(event, 'status') = 'started'
)
GROUP BY round_band
ORDER BY round_band ASC
FORMAT PrettyCompact`.trim()

// Per-trial: search rounds, total searches, ever-specified-count, ever-specified-30, score, pass.
const trialInner = `
SELECT
  JSONExtractString(json, 'taskId') AS taskId,
  JSONExtractInt(json, 'trialIndex') AS trialIndex,
  JSONExtractFloat(json, 'score') AS score,
  JSONExtractBool(json, 'pass') AS pass,
  JSONExtractBool(json, 'trial', 'task', 'metadata', 'gradable') AS gradable,
  arraySum(isSearch) AS totalSearches,
  length(arrayDistinct(arrayMap(t -> tupleElement(t, 1), arrayFilter(t -> tupleElement(t, 2) = 1, arrayZip(asstCum, isSearch))))) AS searchRounds,
  arrayExists(e -> JSONExtractString(e, 'type') = 'tool_call' AND JSONExtractString(e, 'name') = 'you-search' AND JSONExtractString(e, 'status') = 'started' AND JSONHas(e, 'input', 'count'), events) AS everSpecified,
  arrayExists(e -> JSONExtractString(e, 'type') = 'tool_call' AND JSONExtractString(e, 'name') = 'you-search' AND JSONExtractString(e, 'status') = 'started' AND JSONExtractInt(e, 'input', 'count') = 30, events) AS ever30
FROM (${eventsInner})`.trim()

// (B1) Trial-level effect: count behavior vs score (raw — includes the round confound).
const sqlB1 = `
SELECT
  multiIf(NOT everSpecified, 'never specified', ever30, 'ever specified 30', 'ever specified (non-30)') AS count_behavior,
  count() AS trials,
  round(avg(score), 4) AS avg_score,
  round(countIf(pass) / count(), 4) AS pass_rate,
  round(avg(searchRounds), 2) AS avg_rounds,
  round(avg(totalSearches), 2) AS avg_searches
FROM (${trialInner})
WHERE gradable
GROUP BY count_behavior
ORDER BY avg_rounds ASC
FORMAT PrettyCompact`.trim()

// (B2) Effect controlled for search-round band: within a fixed round count, specified vs omitted.
const sqlB2 = `
SELECT
  multiIf(searchRounds = 1, '1', searchRounds = 2, '2', searchRounds <= 4, '3-4', '5+') AS round_band,
  if(everSpecified, 'specified', 'omitted') AS count_set,
  count() AS trials,
  round(avg(score), 4) AS avg_score,
  round(countIf(pass) / count(), 4) AS pass_rate
FROM (${trialInner})
WHERE gradable AND searchRounds > 0
GROUP BY round_band, count_set
ORDER BY round_band ASC, count_set ASC
FORMAT PrettyCompact`.trim()

function block(label: string, sql: string, out: string): string {
  const fence = '```'
  const text = out.endsWith('\n') ? out : `${out}\n`
  return `${label}\n\n${fence}sql\n${sql}\n${fence}\n\n${fence}text\n${text}${fence}\n\n`
}

export async function run(): Promise<string> {
  const [outA, outB1, outB2] = await Promise.all([runSql(sqlA), runSql(sqlB1), runSql(sqlB2)])
  const question =
    "Direction 3a found the model specifies `count` on ~46% of searches but almost never uses the skill's prescribed count=30 (only 9 of 24,999). Two follow-ups: (A) at which search round does the model set count, and does the rate or value change across rounds? (B) does specifying count (or count=30) associate with score, or is any apparent effect just the over-rounding confound (more rounds -> lower score)? B2 controls for search-round band so the count signal is isolated from round count."
  const body =
    block('(A) Count prescription by search round:', sqlA, outA) +
    block('(B1) Trial-level effect — count behavior vs score (raw, includes round confound):', sqlB1, outB1) +
    block('(B2) Effect controlled for search-round band — specified vs omitted, within each round band:', sqlB2, outB2)
  return `## 3b. Search count by round and effect on score\n\n${question}\n\n${body}`
}

if (import.meta.main) await process.stdout.write(await run())
