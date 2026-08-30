import { runSql, tables } from './lib.ts'

// Direction: you-contents truncation/context audit. Runs over data/graded.jsonl trial.trajectory.
// The trajectory records completed tool output as output.content[0].text; Pi turns that into
// the following toolResult message content, so this is the best local proxy for what reached
// the next model call. These queries look for explicit truncation-like markers, payload-size
// pressure, requested/returned URL counts, and assistant messages immediately before/after.

const truncationMarkers = "['truncated', 'omitted', 'content too long', 'token limit', 'context length', 'max tokens']"
const assistantMarkers = "['truncated', 'omitted', 'too long', 'could not read', 'unable to access', 'content limit']"

const completedContentsRows = `
SELECT
  json,
  events,
  event,
  position AS event_position,
  JSONExtractString(json, 'taskId') AS task_id,
  JSONExtractInt(json, 'trialIndex') AS trial_index,
  JSONExtractFloat(json, 'score') AS score,
  JSONExtractBool(json, 'pass') AS pass,
  JSONExtractString(event, 'metadata', 'toolCallId') AS call_id,
  JSONExtractString(JSONExtractRaw(JSONExtractRaw(event, 'output'), 'content', 1), 'text') AS model_text
FROM (
  SELECT
    json,
    events,
    arrayFilter(
      (e, i) -> JSONExtractString(e, 'type') = 'tool_call'
        AND JSONExtractString(e, 'name') = 'you-contents'
        AND JSONExtractString(e, 'status') = 'completed',
      events,
      arrayEnumerate(events)
    ) AS completed_events,
    arrayFilter(
      (i, e) -> JSONExtractString(e, 'type') = 'tool_call'
        AND JSONExtractString(e, 'name') = 'you-contents'
        AND JSONExtractString(e, 'status') = 'completed',
      arrayEnumerate(events),
      events
    ) AS completed_positions
  FROM (
    SELECT json, JSONExtractArrayRaw(json, 'trial', 'trajectory') AS events
    FROM ${tables.graded}
  )
)
ARRAY JOIN completed_events AS event, completed_positions AS position`.trim()

const sql1 = `
SELECT
  count() AS completed_contents_calls,
  countIf(has_truncation_like_marker) AS calls_with_truncation_like_marker,
  round(countIf(has_truncation_like_marker) / count(), 4) AS marker_share,
  round(avg(model_text_chars), 0) AS avg_model_text_chars,
  quantileExact(0.5)(model_text_chars) AS p50_model_text_chars,
  quantileExact(0.9)(model_text_chars) AS p90_model_text_chars,
  quantileExact(0.99)(model_text_chars) AS p99_model_text_chars,
  max(model_text_chars) AS max_model_text_chars,
  countIf(model_text_chars >= 100000) AS calls_ge_100k_chars,
  countIf(model_text_chars >= 500000) AS calls_ge_500k_chars,
  countIf(model_text_chars >= 1000000) AS calls_ge_1m_chars
FROM (
  SELECT
    length(model_text) AS model_text_chars,
    multiSearchAnyCaseInsensitive(model_text, ${truncationMarkers}) AS has_truncation_like_marker
  FROM (${completedContentsRows})
)
FORMAT Vertical`.trim()

const sql2 = `
WITH top_calls AS (
  SELECT
    task_id,
    trial_index,
    event_position,
    has_truncation_like_marker,
    model_text_chars
  FROM (
    SELECT
      task_id,
      trial_index,
      event_position,
      length(model_text) AS model_text_chars,
      multiSearchAnyCaseInsensitive(model_text, ${truncationMarkers}) AS has_truncation_like_marker
    FROM (${completedContentsRows})
  )
  ORDER BY has_truncation_like_marker DESC, model_text_chars DESC, task_id ASC, trial_index ASC, event_position ASC
  LIMIT 15
)
SELECT
  task_id,
  trial_index,
  round(score, 4) AS score,
  pass,
  event_position,
  call_id,
  JSONExtractInt(event, 'durationMs') AS duration_ms,
  length(JSONExtractArrayRaw(started_event, 'input', 'urls')) AS requested_url_count,
  arrayStringConcat(arrayMap(url -> JSONExtractString(url), JSONExtractArrayRaw(started_event, 'input', 'urls')), ', ') AS requested_urls,
  length(JSONExtractArrayRaw(event, 'output', 'details', 'output')) AS returned_page_count,
  arrayStringConcat(arrayMap(page -> toString(length(JSONExtractString(page, 'markdown'))), JSONExtractArrayRaw(event, 'output', 'details', 'output')), ', ') AS returned_markdown_chars,
  length(model_text) AS model_text_chars,
  round(length(model_text) / 4, 0) AS approx_model_text_tokens,
  multiSearchAnyCaseInsensitive(model_text, ${truncationMarkers}) AS has_truncation_like_marker,
  multiSearchAnyCaseInsensitive(next_assistant, ${assistantMarkers}) AS next_assistant_mentions_truncation,
  length(prev_assistant) AS prev_assistant_chars,
  left(replaceAll(prev_assistant, '\n', ' '), 240) AS prev_assistant_preview,
  left(replaceAll(model_text, '\n', ' '), 240) AS model_text_head,
  right(replaceAll(model_text, '\n', ' '), 240) AS model_text_tail,
  length(next_assistant) AS next_assistant_chars,
  left(replaceAll(next_assistant, '\n', ' '), 240) AS next_assistant_preview
FROM (
  SELECT
    *,
    arrayElement(
      arrayFilter(
        e -> JSONExtractString(e, 'type') = 'tool_call'
          AND JSONExtractString(e, 'name') = 'you-contents'
          AND JSONExtractString(e, 'status') = 'started'
          AND JSONExtractString(e, 'metadata', 'toolCallId') = call_id,
        events
      ),
      1
    ) AS started_event,
    arrayElement(
      arrayMap(
        e -> JSONExtractString(e, 'content'),
        arrayFilter(
          (e, i) -> i < event_position
            AND JSONExtractString(e, 'type') = 'message'
            AND JSONExtractString(e, 'role') = 'assistant',
          events,
          arrayEnumerate(events)
        )
      ),
      -1
    ) AS prev_assistant,
    arrayElement(
      arrayMap(
        e -> JSONExtractString(e, 'content'),
        arrayFilter(
          (e, i) -> i > event_position
            AND JSONExtractString(e, 'type') = 'message'
            AND JSONExtractString(e, 'role') = 'assistant',
          events,
          arrayEnumerate(events)
        )
      ),
      1
    ) AS next_assistant
  FROM (${completedContentsRows})
  WHERE (task_id, trial_index, event_position) IN (
    SELECT task_id, trial_index, event_position
    FROM top_calls
  )
)
ORDER BY has_truncation_like_marker DESC, model_text_chars DESC, task_id ASC, trial_index ASC, event_position ASC
FORMAT Vertical`.trim()

const sql3 = `
SELECT
  cohort,
  count() AS trials,
  sum(completed_contents_calls) AS total_completed_contents_calls,
  sum(marker_calls) AS total_marker_calls,
  round(avg(score), 4) AS avg_score,
  round(countIf(pass) / count(), 4) AS pass_rate,
  round(avg(completed_contents_calls), 2) AS avg_completed_contents_calls,
  round(avg(max_model_text_chars), 0) AS avg_max_model_text_chars,
  quantileExact(0.5)(max_model_text_chars) AS p50_max_model_text_chars,
  quantileExact(0.9)(max_model_text_chars) AS p90_max_model_text_chars
FROM (
  SELECT
    if(marker_calls > 0, 'any truncation-like marker', 'no truncation-like marker') AS cohort,
    task_id,
    trial_index,
    any(score) AS score,
    any(pass) AS pass,
    count() AS completed_contents_calls,
    countIf(has_truncation_like_marker) AS marker_calls,
    max(model_text_chars) AS max_model_text_chars
  FROM (
    SELECT
      task_id,
      trial_index,
      score,
      pass,
      length(model_text) AS model_text_chars,
      multiSearchAnyCaseInsensitive(model_text, ${truncationMarkers}) AS has_truncation_like_marker
    FROM (${completedContentsRows})
  )
  GROUP BY task_id, trial_index
)
GROUP BY cohort
ORDER BY cohort ASC
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
    '## 3e. you-contents truncation and assistant context',
    '',
    'When you-contents was called, did the model receive truncated or unusually large content, and what did the assistant say immediately before and after? Query 1 summarizes model-facing payload sizes and explicit truncation-like markers. Query 2 lists the top candidate calls with requested URLs, returned markdown lengths, model-facing payload head/tail, and adjacent assistant messages.',
    '',
    'Interpretation note: the marker check is a heuristic, not proof of transport truncation. Some matches are ordinary page text or CSS class names containing words like "truncated". Treat lower outcomes in the marker cohort as a risk signal that is confounded by larger payloads and more read calls, then inspect Query 2 before attributing failures to truncation.',
    '',
    block('Query 1 - payload size and explicit marker summary:', sql1, out1),
    block('Query 2 - top candidate calls with before/after assistant context:', sql2, out2),
    block('Query 3 - trial outcomes for the 270 truncation-like marker calls:', sql3, out3),
  ].join('\n')
}

if (import.meta.main) await process.stdout.write(await run())
