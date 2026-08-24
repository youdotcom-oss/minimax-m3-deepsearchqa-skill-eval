import { runSql, section, tables } from './lib.ts'

// Direction 5: source diversity and cross-checking. Runs over data/graded.jsonl trial.trajectory.
// The skill requires cross-checking key facts across at least two independent sources. Per trial,
// gather distinct domains across every you-contents input URL, then bucket by distinct-source
// count (1, 2, 3+) and compare correctness, split by answer_type (Single vs Set), since multi-hop
// set answers should need more sources.
const sql = `
SELECT
  answer_type,
  band AS source_band,
  count() AS trials,
  round(avg(score), 4) AS avg_score,
  round(countIf(pass) / count(), 4) AS pass_rate
FROM (
  SELECT
    answer_type,
    multiIf(distinctDomains = 1, '1 source', distinctDomains = 2, '2 sources', '3+ sources') AS band,
    score, pass
  FROM (
    SELECT task_id, trial_index, answer_type, score, pass,
      uniqExact(domain) AS distinctDomains
    FROM (
      SELECT
        JSONExtractString(json, 'taskId') AS task_id,
        JSONExtractInt(json, 'trialIndex') AS trial_index,
        JSONExtractFloat(json, 'score') AS score,
        JSONExtractBool(json, 'pass') AS pass,
        JSONExtractString(json, 'trial', 'task', 'metadata', 'answer_type') AS answer_type,
        domain(JSONExtractString(urlRaw)) AS domain
      FROM (
        SELECT json, JSONExtractArrayRaw(event, 'input', 'urls') AS urls
        FROM ${tables.graded}
        ARRAY JOIN JSONExtractArrayRaw(json, 'trial', 'trajectory') AS event
        WHERE JSONExtractString(event, 'name') = 'you-contents'
          AND JSONExtractString(event, 'status') = 'started'
      )
      ARRAY JOIN urls AS urlRaw
      WHERE JSONExtractString(urlRaw) != ''
    )
    GROUP BY task_id, trial_index, answer_type, score, pass
  )
)
GROUP BY answer_type, band
ORDER BY answer_type ASC, band ASC
FORMAT PrettyCompact`.trim()

export async function run(): Promise<string> {
  return section({
    title: '5. Source diversity and cross-checking',
    question:
      'The skill requires cross-checking key facts across at least two independent sources. Does the model actually cross-check, or does it anchor on one source? Per trial, count distinct domains across you-contents URLs, bucket by distinct-source count (1, 2, 3+), and compare correctness split by answer type (Single vs Set).',
    sql,
    output: await runSql(sql),
  })
}

if (import.meta.main) await process.stdout.write(await run())
