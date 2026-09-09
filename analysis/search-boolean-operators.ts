import { runSql, tables } from './lib.ts'

const upperAndPattern = "'(^|\\\\s)AND(\\\\s|$)'"
const upperOrPattern = "'(^|\\\\s)OR(\\\\s|$)'"
const lowerAndPattern = "'(^|\\\\s)and(\\\\s|$)'"
const lowerOrPattern = "'(^|\\\\s)or(\\\\s|$)'"

const searchRows = `
WITH
  JSONExtractArrayRaw(json, 'trial', 'trajectory') AS trajectory,
  arrayFilter(
    event -> JSONExtractString(event, 'type') = 'tool_call'
      AND JSONExtractString(event, 'status') = 'started'
      AND JSONExtractString(event, 'name') = 'you-search',
    trajectory
  ) AS started_events,
  arrayFilter(
    event -> JSONExtractString(event, 'type') = 'tool_call'
      AND JSONExtractString(event, 'status') = 'completed'
      AND JSONExtractString(event, 'name') = 'you-search',
    trajectory
  ) AS completed_events
SELECT
  JSONExtractString(json, 'taskId') AS task_id,
  JSONExtractInt(json, 'trialIndex') AS trial_index,
  JSONExtractFloat(json, 'score') AS score,
  JSONExtractBool(json, 'pass') AS pass,
  JSONExtractBool(json, 'trial', 'task', 'metadata', 'gradable') AS gradable,
  JSONExtractString(tupleElement(paired_event, 1), 'input', 'query') AS query,
  replaceRegexpAll(query, '"[^"]*"', ' ') AS operator_query,
  length(arrayFilter(x -> x != '', splitByRegexp('[^0-9A-Za-z]+', query))) AS word_count,
  match(operator_query, ${upperAndPattern}) AS uses_upper_and,
  match(operator_query, ${upperOrPattern}) AS uses_upper_or,
  match(operator_query, ${lowerAndPattern}) AS uses_lower_and,
  match(operator_query, ${lowerOrPattern}) AS uses_lower_or,
  multiIf(
    uses_upper_and AND uses_upper_or, 'mixed uppercase AND/OR',
    (uses_upper_and OR uses_upper_or) AND (uses_lower_and OR uses_lower_or), 'mixed case',
    uses_upper_and, 'uppercase AND',
    uses_upper_or, 'uppercase OR',
    uses_lower_and AND uses_lower_or, 'lowercase AND and OR',
    uses_lower_and, 'lowercase AND',
    uses_lower_or, 'lowercase OR',
    'no boolean operator'
  ) AS boolean_cohort,
  uses_upper_and OR uses_upper_or AS uses_upper_boolean,
  uses_lower_and OR uses_lower_or AS uses_lower_boolean,
  arrayFilter(
    token -> token != '',
    [
      if(uses_lower_and, 'lowercase AND', NULL),
      if(uses_lower_or, 'lowercase OR', NULL)
    ]
  ) AS lowercase_tokens,
  JSONExtractArrayRaw(tupleElement(paired_event, 2), 'output', 'content') AS output_content,
  JSONExtractString(arrayFilter(x -> JSONExtractString(x, 'type') = 'text', output_content)[1], 'text') AS response_text,
  length(JSONExtractArrayRaw(response_text, 'results', 'web')) AS result_count
FROM ${tables.graded}
ARRAY JOIN arrayZip(started_events, completed_events) AS paired_event
WHERE length(started_events) = length(completed_events)`.trim()

const sql1 = `
SELECT
  boolean_cohort,
  count() AS calls,
  round(count() / sum(count()) OVER (), 4) AS call_share,
  uniqExact(concat(task_id, '#', toString(trial_index))) AS trials,
  round(avg(word_count), 2) AS avg_query_words,
  round(avg(result_count), 2) AS avg_returned_results,
  round(countIf(result_count = 0) / count(), 4) AS zero_result_share,
  round(avg(score), 4) AS avg_trial_score,
  round(countIf(pass) / count(), 4) AS call_weighted_pass_rate
FROM (${searchRows})
WHERE gradable
GROUP BY boolean_cohort
ORDER BY calls DESC, boolean_cohort ASC
FORMAT PrettyCompact`.trim()

const sql2 = `
SELECT
  lowercase_token,
  count() AS calls,
  uniqExact(concat(task_id, '#', toString(trial_index))) AS trials,
  round(avg(word_count), 2) AS avg_query_words,
  round(avg(result_count), 2) AS avg_returned_results,
  round(countIf(result_count = 0) / count(), 4) AS zero_result_share,
  round(avg(score), 4) AS avg_trial_score,
  round(countIf(pass) / count(), 4) AS call_weighted_pass_rate
FROM (${searchRows})
ARRAY JOIN lowercase_tokens AS lowercase_token
WHERE gradable AND uses_lower_boolean
GROUP BY lowercase_token
ORDER BY calls DESC, lowercase_token ASC
FORMAT PrettyCompact`.trim()

const sql3 = `
SELECT
  cohort,
  count() AS trials,
  sum(lower_boolean_calls) AS lowercase_boolean_calls,
  round(avg(score), 4) AS avg_score,
  round(countIf(pass) / count(), 4) AS pass_rate,
  round(avg(lower_result_count), 2) AS avg_lower_results,
  round(avgIf(non_lower_result_count, non_lower_calls > 0), 2) AS avg_same_trial_non_lower_results,
  round(avgIf(non_lower_result_count - lower_result_count, non_lower_calls > 0), 2) AS avg_result_delta,
  round(countIf(lower_zero_results > 0) / count(), 4) AS trials_with_zero_result_lower_call
FROM (
  SELECT
    multiIf(
      has_lower_boolean AND has_upper_boolean, 'lowercase + uppercase',
      has_lower_boolean, 'lowercase boolean present',
      has_upper_boolean, 'uppercase only',
      'no boolean operator'
    ) AS cohort,
    task_id,
    trial_index,
    any(score) AS score,
    any(pass) AS pass,
    countIf(uses_lower_boolean) AS lower_boolean_calls,
    countIf(NOT uses_lower_boolean) AS non_lower_calls,
    avgIf(result_count, uses_lower_boolean) AS lower_result_count,
    avgIf(result_count, NOT uses_lower_boolean) AS non_lower_result_count,
    countIf(uses_lower_boolean AND result_count = 0) AS lower_zero_results,
    max(uses_lower_boolean) AS has_lower_boolean,
    max(uses_upper_boolean) AS has_upper_boolean
  FROM (${searchRows})
  WHERE gradable
  GROUP BY task_id, trial_index
)
GROUP BY cohort
ORDER BY trials DESC, cohort ASC
FORMAT PrettyCompact`.trim()

export async function run(): Promise<string> {
  const out1 = await runSql(sql1)
  const out2 = await runSql(sql2)
  const out3 = await runSql(sql3)

  const query1 = `Query 1 — uppercase AND/OR usage across started you-search calls:`
  const query2 = `Query 2 — lowercase boolean tokens in lowercase-only searches:`
  const query3 = `Query 3 — trial outcomes and same-trial result-count comparison:`

  return [
    '## 3d.1. Search boolean operators: uppercase compliance and lowercase effect',
    '',
    'This isolates standalone `AND`/`OR` tokens outside quoted phrases. Uppercase use is correct only when the query does not mix `AND` and `OR`; lowercase use is a rule violation. Search outcome is measured by the number of `results.web` entries returned and by a paired comparison between lowercase and non-lowercase searches within the same trial. Trial score and pass rate are contextual, not causal evidence.',
    '',
    `${query1}\n\n\`\`\`sql\n${sql1}\n\`\`\`\n\n\`\`\`text\n${out1}\n\`\`\``,
    '',
    `${query2}\n\n\`\`\`sql\n${sql2}\n\`\`\`\n\n\`\`\`text\n${out2}\n\`\`\``,
    '',
    `${query3}\n\n\`\`\`sql\n${sql3}\n\`\`\`\n\n\`\`\`text\n${out3}\n\`\`\``,
    '',
  ].join('\n')
}

if (import.meta.main) await process.stdout.write(await run())
