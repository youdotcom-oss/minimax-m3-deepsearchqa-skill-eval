import { runSql, tables } from './lib.ts'

// Direction 7: Zero-result you-search calls and what the model does next.
// Runs over data/graded.jsonl trial.trajectory. A zero-result call is a started
// you-search whose completed event returned zero `results.web` entries. The
// follow-up event in the same trial classifies the recovery: read with
// you-contents, search again (verbatim / narrowed / expanded / reworded),
// switch tools, or stop. A separate cohort isolates argument-shape errors:
// started searches whose query string is present in the raw event but nested
// under input.extraction instead of input, which the flat-path projection
// misses. Recovery style vs trial outcome is the observational evidence a
// recovery prompt would stand on.

const wordCount = (q: string) =>
  `length(arrayFilter(x -> x != '', splitByRegexp('[^0-9A-Za-z]+', replaceRegexpAll(${q}, '"[^"]*"', ' '))))`

const disallowedColonOperatorPattern = "'(?i)(^|\\\\s)(site|lang|loc|filetype|ext|inpage):'"
const notOperatorPattern = "'(^|\\\\s)NOT(\\\\s|$)'"
const operatorQuery = (q: string) => `replaceRegexpAll(${q}, '"[^"]*"', ' ')`

// Index-only ARRAY JOINs OOM at full scale and nested paths mis-evaluate
// inside arrayMap, so pair each trajectory element with its neighbor via a
// shifted arrayZip and join small (String, String) tuples only.
const eventRows = `
SELECT
  task_id, trial_index, score, pass, gradable,
  tupleElement(paired, 1) AS event,
  tupleElement(paired, 2) AS next_event,
  JSONExtractString(event, 'type') AS type,
  JSONExtractString(event, 'name') AS name,
  JSONExtractString(event, 'status') AS status,
  JSONExtractString(event, 'input', 'query') AS query,
  ${wordCount('query')} AS word_count,
  length(JSONExtractArrayRaw(JSONExtractString(arrayFilter(x -> JSONExtractString(x, 'type') = 'text', JSONExtractArrayRaw(event, 'output', 'content'))[1], 'text'), 'results', 'web')) AS result_count,
  JSONExtractString(next_event, 'type') AS next_type,
  JSONExtractString(next_event, 'name') AS next_name,
  JSONExtractString(next_event, 'status') AS next_status,
  JSONExtractString(next_event, 'input', 'query') AS next_query,
  ${wordCount('next_query')} AS next_word_count,
  match(${operatorQuery('next_query')}, ${disallowedColonOperatorPattern})
    OR match(${operatorQuery('next_query')}, ${notOperatorPattern}) AS next_uses_unsupported_operator
FROM (
  SELECT
    JSONExtractString(json, 'taskId') AS task_id,
    JSONExtractInt(json, 'trialIndex') AS trial_index,
    JSONExtractFloat(json, 'score') AS score,
    JSONExtractBool(json, 'pass') AS pass,
    JSONExtractBool(json, 'trial', 'task', 'metadata', 'gradable') AS gradable,
    JSONExtractArrayRaw(json, 'trial', 'trajectory') AS trajectory
  FROM ${tables.graded}
)
ARRAY JOIN arrayZip(trajectory, arrayResize(arrayPushFront(arrayPopBack(trajectory), ''), length(trajectory), '')) AS paired
WHERE JSONExtractString(event, 'type') = 'tool_call'
  AND JSONExtractString(event, 'name') = 'you-search'
  AND JSONExtractString(event, 'status') IN ('started', 'completed')`.trim()

const sql1 = `
SELECT
  countIf(status = 'started') AS started_searches,
  countIf(status = 'completed') AS completed_searches,
  round(countIf(status = 'completed' AND result_count = 0) / completed_searches, 4) AS zero_result_share,
  uniqExactIf(concat(task_id, '#', toString(trial_index)), status = 'completed' AND result_count = 0) AS trials_with_zero_result,
  round(countIf(status = 'started' AND (match(${operatorQuery('query')}, ${disallowedColonOperatorPattern}) OR match(${operatorQuery('query')}, ${notOperatorPattern}))) / countIf(status = 'started'), 4) AS unsupported_operator_share
FROM (${eventRows})
WHERE gradable
FORMAT PrettyCompact`.trim()

const sql2 = `
SELECT
  multiIf(
    NOT empty(JSONExtractString(event, 'input', 'query')), 'flat (input.query)',
    position(event, '"query"') > 0, 'nested (input.extraction.query)',
    'no query string'
  ) AS shape,
  count() AS calls,
  round(count() / sum(count()) OVER (), 4) AS share,
  uniqExact(concat(task_id, '#', toString(trial_index))) AS trials,
  round(avg(score), 4) AS avg_trial_score,
  round(countIf(pass) / count(), 4) AS call_weighted_pass_rate
FROM (${eventRows})
WHERE gradable AND status = 'started'
GROUP BY shape
ORDER BY calls DESC
FORMAT PrettyCompact`.trim()

const sql3 = `
SELECT
  multiIf(
    next_name NOT IN ('you-search', 'you-contents'), if(next_type = 'tool_call', concat('switched to ', next_name), 'no follow-up event'),
    next_name = 'you-contents', 'read after zero-results',
    next_word_count = 0, 'searched with empty query',
    next_query = query AND next_uses_unsupported_operator, 'repeated with operators',
    next_query = query, 'repeated verbatim',
    'reworded'
  ) AS recovery,
  count() AS calls,
  round(count() / sum(count()) OVER (), 4) AS share,
  round(avg(score), 4) AS avg_trial_score,
  round(countIf(pass) / count(), 4) AS call_weighted_pass_rate
FROM (${eventRows})
WHERE gradable AND status = 'completed' AND result_count = 0
GROUP BY recovery
ORDER BY calls DESC
FORMAT PrettyCompact`.trim()

const sql4 = `
SELECT
  task_id,
  trial_index,
  round(score, 4) AS score,
  query AS zero_result_query,
  word_count,
  if(next_name = 'you-search', 'searched again', if(next_name = 'you-contents', 'read', if(next_type = 'tool_call', concat('used ', next_name), 'stopped'))) AS next_action,
  next_query
FROM (${eventRows})
WHERE gradable AND status = 'completed' AND result_count = 0
ORDER BY score ASC, task_id ASC, trial_index ASC
LIMIT 10
FORMAT Vertical`.trim()

export async function run(): Promise<string> {
  const out1 = await runSql(sql1)
  const out2 = await runSql(sql2)
  const out3 = await runSql(sql3)
  const out4 = await runSql(sql4)

  const query1 = 'Query 1 — overall zero-result and unsupported-operator profile across you-search calls:'
  const query2 = 'Query 2 — argument-shape cohorts across started you-search calls:'
  const query3 = 'Query 3 — recovery cohorts after a zero-result search:'
  const query4 = 'Query 4 — failed-eval examples with zero-result query and follow-up:'

  return [
    '## 7. Zero-result you-search calls and recovery behavior',
    '',
    'Zero-result searches are a 0.53% tail (132 calls across 46 trials of 24,775 completed searches), but what the model does next is concentrated and mostly wrong: it searches again 95% of the time and reads only 5% of the time. The worst recovery is the most degenerate — 54 calls (41%) re-search with an empty query string, scoring avg trial score 0.6878 at a 0.3704 call-weighted pass rate. A separate cohort isolates argument-shape errors: 39 calls across 11 trials where the query string is present in the raw event but nested under `input.extraction` instead of `input` — always fatal (0% pass). Unsupported operator syntax (`site:`, `lang:`, `loc:`, `filetype:`, `ext:`, `inpage:`, uppercase `NOT`) appears in 5.01% of searches, consistent with the 1,245 violating calls measured by direction 3d; PR #109 normalizes `site:`/`lang:`/`loc:` server-side, so the remaining violations narrow to pass-through operators and `NOT`.',
    '',
    'Caveats: word-count-based narrowed/expanded distinctions are unreliable in this clickhouse-local build (nested lambdas mis-evaluate), so re-searches with a different non-empty query are grouped as `reworded`. All patterns are observational across a single model × harness × tool surface; the trial-length confound applies.',
    '',
    `${query1}\n\n\`\`\`sql\n${sql1}\n\`\`\`\n\n\`\`\`text\n${out1}\n\`\`\``,
    '',
    `${query2}\n\n\`\`\`sql\n${sql2}\n\`\`\`\n\n\`\`\`text\n${out2}\n\`\`\``,
    '',
    `${query3}\n\n\`\`\`sql\n${sql3}\n\`\`\`\n\n\`\`\`text\n${out3}\n\`\`\``,
    '',
    `${query4}\n\n\`\`\`sql\n${sql4}\n\`\`\`\n\n\`\`\`text\n${out4}\n\`\`\``,
    '',
  ].join('\n')
}

if (import.meta.main) await process.stdout.write(await run())
