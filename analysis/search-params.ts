import { runSql, tables } from './lib.ts'

// Direction 3c (deeper dig into 3). Runs over data/graded.jsonl trial.trajectory.
// 3/3a/3b covered `query` and `count`. The you-search tool (per SearchQuerySchema in the
// youdotcom-mcp-server) accepts more parameters: freshness, offset, country, safesearch, language,
// include_domains, exclude_domains, boost_domains, extraction (extraction_mode), crawl_timeout.
// (A) Which of these does the model actually set, and with what values? (B) Does any associate with
// score — or is any apparent effect just the over-rounding confound? avg_rounds is shown so the
// confound is visible (more rounds -> lower score).

// Shared per-trial arrays: events, asstCum (cumulative assistant-message count), isSearch.
const eventsInner = `
SELECT json, events,
  arrayCumSum(arrayMap(e -> if(JSONExtractString(e, 'type') = 'message' AND JSONExtractString(e, 'role') = 'assistant', 1, 0), events)) AS asstCum,
  arrayMap(e -> if(JSONExtractString(e, 'type') = 'tool_call' AND JSONExtractString(e, 'name') = 'you-search' AND JSONExtractString(e, 'status') = 'started', 1, 0), events) AS isSearch
FROM (
  SELECT json, JSONExtractArrayRaw(json, 'trial', 'trajectory') AS events
  FROM ${tables.graded}
)`.trim()

// (A) Per started you-search: for each optional parameter, emit (param, value) when present.
// One scan; arrayFilter drops the '__none__' sentinel for absent params, arrayJoin expands to long.
const sqlA = `
SELECT param, value, count() AS uses
FROM (
  SELECT
    arrayJoin(
      arrayFilter(
        x -> tupleElement(x, 2) != '__none__',
        [
          tuple('freshness',       if(JSONHas(event, 'input', 'freshness'),       JSONExtractString(event, 'input', 'freshness'), '__none__')),
          tuple('offset',           if(JSONHas(event, 'input', 'offset'),           toString(JSONExtractInt(event, 'input', 'offset')), '__none__')),
          tuple('country',          if(JSONHas(event, 'input', 'country'),          JSONExtractString(event, 'input', 'country'), '__none__')),
          tuple('safesearch',       if(JSONHas(event, 'input', 'safesearch'),       JSONExtractString(event, 'input', 'safesearch'), '__none__')),
          tuple('language',         if(JSONHas(event, 'input', 'language'),         JSONExtractString(event, 'input', 'language'), '__none__')),
          tuple('include_domains',  if(JSONHas(event, 'input', 'include_domains'),  concat('n=', toString(length(JSONExtractArrayRaw(event, 'input', 'include_domains')))), '__none__')),
          tuple('exclude_domains',  if(JSONHas(event, 'input', 'exclude_domains'),  concat('n=', toString(length(JSONExtractArrayRaw(event, 'input', 'exclude_domains')))), '__none__')),
          tuple('boost_domains',    if(JSONHas(event, 'input', 'boost_domains'),    concat('n=', toString(length(JSONExtractArrayRaw(event, 'input', 'boost_domains')))), '__none__')),
          tuple('extraction_mode',  if(JSONHas(event, 'input', 'extraction'),       JSONExtractString(event, 'input', 'extraction', 'extraction_mode'), '__none__')),
          tuple('crawl_timeout',    if(JSONHas(event, 'input', 'crawl_timeout'),    toString(JSONExtractInt(event, 'input', 'crawl_timeout')), '__none__'))
        ]
      )
    ) AS p,
    tupleElement(p, 1) AS param,
    tupleElement(p, 2) AS value
  FROM (
    SELECT event
    FROM (${eventsInner})
    ARRAY JOIN events AS event
    WHERE JSONExtractString(event, 'type') = 'tool_call'
      AND JSONExtractString(event, 'name') = 'you-search'
      AND JSONExtractString(event, 'status') = 'started'
  )
)
GROUP BY param, value
ORDER BY param ASC, uses DESC
FORMAT PrettyCompact`.trim()

// (B) Per trial: ever-used flag for each optional parameter, then long format param x usage.
// searchRounds included so avg_rounds exposes the over-rounding confound in the used-vs-not split.
const sqlB = `
SELECT
  param,
  if(used, 'used', 'not used') AS usage,
  count() AS trials,
  round(avg(score), 4) AS avg_score,
  round(countIf(pass) / count(), 4) AS pass_rate,
  round(avg(searchRounds), 2) AS avg_rounds
FROM (
  SELECT score, pass, searchRounds,
    arrayJoin([
      tuple('freshness',      toUInt8(arrayExists(e -> JSONHas(e, 'input', 'freshness'),      searchEvents))),
      tuple('offset',          toUInt8(arrayExists(e -> JSONHas(e, 'input', 'offset'),          searchEvents))),
      tuple('country',         toUInt8(arrayExists(e -> JSONHas(e, 'input', 'country'),         searchEvents))),
      tuple('safesearch',      toUInt8(arrayExists(e -> JSONHas(e, 'input', 'safesearch'),      searchEvents))),
      tuple('language',        toUInt8(arrayExists(e -> JSONHas(e, 'input', 'language'),        searchEvents))),
      tuple('include_domains', toUInt8(arrayExists(e -> JSONHas(e, 'input', 'include_domains'), searchEvents))),
      tuple('exclude_domains', toUInt8(arrayExists(e -> JSONHas(e, 'input', 'exclude_domains'), searchEvents))),
      tuple('boost_domains',   toUInt8(arrayExists(e -> JSONHas(e, 'input', 'boost_domains'),   searchEvents))),
      tuple('extraction_mode', toUInt8(arrayExists(e -> JSONHas(e, 'input', 'extraction'),      searchEvents))),
      tuple('crawl_timeout',   toUInt8(arrayExists(e -> JSONHas(e, 'input', 'crawl_timeout'),   searchEvents)))
    ]) AS p,
    tupleElement(p, 1) AS param,
    tupleElement(p, 2) AS used
  FROM (
    SELECT score, pass, searchRounds, searchEvents
    FROM (
      SELECT
        JSONExtractFloat(json, 'score') AS score,
        JSONExtractBool(json, 'pass') AS pass,
        JSONExtractBool(json, 'trial', 'task', 'metadata', 'gradable') AS gradable,
        arrayFilter(e -> JSONExtractString(e, 'type') = 'tool_call' AND JSONExtractString(e, 'name') = 'you-search' AND JSONExtractString(e, 'status') = 'started', events) AS searchEvents,
        length(arrayDistinct(arrayMap(t -> tupleElement(t, 1), arrayFilter(t -> tupleElement(t, 2) = 1, arrayZip(asstCum, isSearch))))) AS searchRounds
      FROM (${eventsInner})
    )
    WHERE gradable AND searchRounds > 0
  )
)
GROUP BY param, usage
ORDER BY param ASC, usage ASC
FORMAT PrettyCompact`.trim()

function block(label: string, sql: string, out: string): string {
  const fence = '```'
  const text = out.endsWith('\n') ? out : `${out}\n`
  return `${label}\n\n${fence}sql\n${sql}\n${fence}\n\n${fence}text\n${text}${fence}\n\n`
}

export async function run(): Promise<string> {
  const [outA, outB] = await Promise.all([runSql(sqlA), runSql(sqlB)])
  const question =
    'Beyond `query` and `count` (covered in 3/3a/3b), you-search accepts freshness, offset, country, safesearch, language, include_domains, exclude_domains, boost_domains, extraction (extraction_mode), and crawl_timeout. (A) Which does the model actually set, and with what values? (B) Does any associate with score — or is any apparent effect just the over-rounding confound? avg_rounds is shown so the confound is visible (more rounds -> lower score).'
  const body =
    block('(A) Per-call usage and value distribution (only present params appear):', sqlA, outA) +
    block('(B) Trial-level used vs not used — score, pass, avg search rounds:', sqlB, outB)
  return `## 3c. you-search parameter usage and effect on success\n\n${question}\n\n${body}`
}

if (import.meta.main) await process.stdout.write(await run())
