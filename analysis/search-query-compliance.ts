import { runSql, tables } from './lib.ts'

// Direction: you-search query-input rule compliance. Runs over data/graded.jsonl trial.trajectory.
// Checks the search query string against the skill rule:
// concise keyword query, 3-6 words; allowed operators are exact phrases, intitle:, inbody:,
// -term, +term, uppercase AND/OR without mixing; forbidden operators include site:, lang:,
// loc:, filetype:, ext:, inpage:, and NOT.

const disallowedColonOperatorPattern = "'(?i)(^|\\\\s)(site|lang|loc|filetype|ext|inpage):'"
const notOperatorPattern = "'(^|\\\\s)NOT(\\\\s|$)'"
const lowercaseBooleanPattern = "'(^|\\\\s)(and|or)(\\\\s|$)'"
const upperAndPattern = "'(^|\\\\s)AND(\\\\s|$)'"
const upperOrPattern = "'(^|\\\\s)OR(\\\\s|$)'"
const colonOperatorPattern = "'(?i)\\\\b([a-z][a-z0-9_-]*):'"

const searchRows = `
SELECT
  JSONExtractString(json, 'taskId') AS task_id,
  JSONExtractInt(json, 'trialIndex') AS trial_index,
  JSONExtractFloat(json, 'score') AS score,
  JSONExtractBool(json, 'pass') AS pass,
  JSONExtractBool(json, 'trial', 'task', 'metadata', 'gradable') AS gradable,
  JSONExtractString(event, 'input', 'query') AS query,
  replaceRegexpAll(query, '"[^"]*"', ' ') AS operator_query,
  length(arrayFilter(x -> x != '', splitByRegexp('[^0-9A-Za-z]+', query))) AS word_count,
  word_count < 3 OR word_count > 6 AS violates_word_count,
  match(operator_query, ${disallowedColonOperatorPattern})
    OR match(operator_query, ${notOperatorPattern}) AS uses_disallowed_operator,
  match(operator_query, ${lowercaseBooleanPattern}) AS uses_lowercase_boolean,
  match(operator_query, ${upperAndPattern}) AND match(operator_query, ${upperOrPattern}) AS mixes_and_or,
  arrayFilter(
    op -> NOT has(['intitle', 'inbody', 'site', 'lang', 'loc', 'filetype', 'ext', 'inpage'], lower(op)),
    extractAll(operator_query, ${colonOperatorPattern})
  ) AS unsupported_colon_ops,
  length(unsupported_colon_ops) > 0 AS uses_unsupported_colon_operator,
  uses_disallowed_operator
    OR uses_lowercase_boolean
    OR mixes_and_or
    OR uses_unsupported_colon_operator AS has_operator_violation,
  violates_word_count
    OR has_operator_violation AS violates_query_rule
FROM ${tables.graded}
ARRAY JOIN JSONExtractArrayRaw(json, 'trial', 'trajectory') AS event
WHERE JSONExtractString(event, 'type') = 'tool_call'
  AND JSONExtractString(event, 'name') = 'you-search'
  AND JSONExtractString(event, 'status') = 'started'`.trim()

const sql1 = `
SELECT
  violation_type,
  count() AS violating_calls,
  uniqExact(concat(task_id, '#', toString(trial_index))) AS affected_trials,
  round(avg(score), 4) AS avg_trial_score,
  round(countIf(pass) / count(), 4) AS call_weighted_pass_rate,
  round(avg(word_count), 2) AS avg_query_words
FROM (
  SELECT
    task_id,
    trial_index,
    score,
    pass,
    word_count,
    arrayJoin(
      arrayFilter(
        x -> tupleElement(x, 2),
        [
          tuple('word count outside 3-6', violates_word_count),
          tuple('disallowed operator', uses_disallowed_operator),
          tuple('lowercase boolean', uses_lowercase_boolean),
          tuple('mixed AND/OR', mixes_and_or),
          tuple('unsupported colon operator', uses_unsupported_colon_operator)
        ]
      )
    ) AS violation,
    tupleElement(violation, 1) AS violation_type
  FROM (${searchRows})
  WHERE gradable AND violates_query_rule
)
GROUP BY violation_type
ORDER BY violating_calls DESC, violation_type ASC
FORMAT Vertical`.trim()

const sql2 = `
SELECT
  cohort,
  count() AS trials,
  sum(search_calls) AS total_search_calls,
  sum(word_count_violating_calls) AS total_word_count_violating_calls,
  sum(operator_violating_calls) AS total_operator_violating_calls,
  round(avg(score), 4) AS avg_score,
  round(countIf(pass) / count(), 4) AS pass_rate,
  round(avg(search_calls), 2) AS avg_search_calls,
  round(avg(word_count_violating_calls), 2) AS avg_word_count_violating_calls,
  round(avg(operator_violating_calls), 2) AS avg_operator_violating_calls,
  round(avg(max_word_count), 2) AS avg_max_query_words
FROM (
  SELECT
    multiIf(
      has_any_word_count_violation AND has_any_operator_violation, 'word-count + operator',
      has_any_operator_violation, 'operator only',
      has_any_word_count_violation, 'word-count only',
      'no violation'
    ) AS cohort,
    task_id,
    trial_index,
    any(score) AS score,
    any(pass) AS pass,
    count() AS search_calls,
    countIf(violates_word_count) AS word_count_violating_calls,
    countIf(has_operator_violation) AS operator_violating_calls,
    max(violates_word_count) AS has_any_word_count_violation,
    max(has_operator_violation) AS has_any_operator_violation,
    max(word_count) AS max_word_count
  FROM (${searchRows})
  WHERE gradable
  GROUP BY task_id, trial_index
)
GROUP BY cohort
ORDER BY cohort ASC
FORMAT Vertical`.trim()

const sql3 = `
SELECT
  task_id,
  trial_index,
  round(score, 4) AS score,
  word_count,
  violates_word_count,
  has_operator_violation,
  arrayStringConcat(
    arrayFilter(
      x -> x != '',
      [
        if(violates_word_count, 'word_count', ''),
        if(uses_disallowed_operator, 'disallowed_operator', ''),
        if(uses_lowercase_boolean, 'lowercase_boolean', ''),
        if(mixes_and_or, 'mixed_AND_OR', ''),
        if(uses_unsupported_colon_operator, concat('unsupported_colon:', arrayStringConcat(unsupported_colon_ops, ',')), '')
      ]
    ),
    ', '
  ) AS violation_reasons,
  query
FROM (${searchRows})
WHERE gradable
  AND NOT pass
  AND violates_query_rule
ORDER BY has_operator_violation DESC, score ASC, word_count DESC, task_id ASC, trial_index ASC
LIMIT 10
FORMAT Vertical`.trim()

function block(label: string, sql: string, out: string): string {
  const fence = '```'
  const text = out.endsWith('\n') ? out : `${out}\n`
  return `${label}\n\n${fence}sql\n${sql}\n${fence}\n\n${fence}text\n${text}${fence}\n\n`
}

export async function run(): Promise<string> {
  const out1 = await runSql(sql1)
  const out2 = await runSql(sql2)
  const out3 = await runSql(sql3)

  return [
    '## 3d. you-search query string rule compliance',
    '',
    'The skill asks for concise keyword queries of 3-6 words and only a narrow operator set: exact phrases, `intitle:term`, `inbody:term`, `-term`, `+term`, and uppercase `AND`/`OR` without mixing. Domain, language, country, and recency filtering should use separate tool parameters, so `site:`, `lang:`, `loc:`, `filetype:`, `ext:`, `inpage:`, and `NOT` are operator violations. These queries keep word-count violations and operator violations separate, then compare their combined trial-level cohorts.',
    '',
    'Finding: word-count violations are nearly universal among search-heavy runs, so they are tracked but are not the main signal here. The most significant operator-specific result is disallowed filter/operator syntax: `site:`, `lang:`, `loc:`, `filetype:`, `ext:`, `inpage:`, or uppercase `NOT` appeared in 1,245 calls across 675 trials, with a call-weighted pass rate of 0.4169. At the trial level, word-count-only trials passed at 0.6907, while trials with both word-count and operator violations passed at 0.4728. The operator-only cohort has just 2 trials, so it is useful as a sanity check but too small for a stable conclusion. Operator checks ignore quoted exact phrases, because exact phrases are allowed. The failed examples show concrete operator-rule breaks such as `site:` in the query string and lowercase boolean tokens; no mixed uppercase `AND`/`OR` cases appeared.',
    '',
    'Implication: an auto-research extension can handle this deterministically instead of only rejecting the call. For example, parse `site:example.com` out of `query`, move it into `include_domains`, remove the operator from the keyword query, execute the reshaped tool call, and include the normalized call alongside the result returned to the model. That gives the model immediate in-context feedback about the valid tool shape while preserving forward progress.',
    '',
    block('Query 1 - violation types across started you-search calls:', sql1, out1),
    block('Query 2 - trial outcomes by word-count and operator violations:', sql2, out2),
    block('Query 3 - failed eval examples with violating query input:', sql3, out3),
  ].join('\n')
}

if (import.meta.main) await process.stdout.write(await run())
