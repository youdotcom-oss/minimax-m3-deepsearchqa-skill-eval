import { runSql, section, tables } from './lib.ts'

// Direction 4: citation and output-format fidelity. Runs over data/graded.jsonl trial.trajectory.
// The skill mandates real-URL inline citations and an Answer / Evidence / Sources section
// structure. Extract the final assistant message, count citation URLs, detect the section
// headers, and compare citation count against contentsPages (cited-without-reading vs
// read-but-not-cited). Bucket by citation count and compare correctness.
const sql = `
SELECT
  band AS citation_band,
  count() AS trials,
  round(avg(score), 4) AS avg_score,
  round(countIf(pass) / count(), 4) AS pass_rate,
  round(avg(contentsPages), 2) AS avg_contents_pages,
  countIf(hasAnswer) AS has_answer_section,
  countIf(hasEvidence) AS has_evidence_section,
  countIf(hasSources) AS has_sources_section,
  countIf(citationCount > contentsPages) AS cited_more_than_read
FROM (
  SELECT
    multiIf(
      citationCount = 0, '0 citations',
      citationCount <= 2, '1-2 citations',
      '3+ citations'
    ) AS band,
    score, pass, contentsPages, citationCount, hasAnswer, hasEvidence, hasSources
  FROM (
    SELECT
      JSONExtractFloat(json, 'score') AS score,
      JSONExtractBool(json, 'pass') AS pass,
      JSONExtractInt(json, 'trial', 'metadata', 'youApiUsage', 'contentsPages') AS contentsPages,
      length(extractAll(content, 'https?://[0-9A-Za-z./_:?=&%~+#-]+')) AS citationCount,
      positionCaseInsensitive(content, '## Answer') > 0 AS hasAnswer,
      positionCaseInsensitive(content, '## Evidence') > 0 AS hasEvidence,
      positionCaseInsensitive(content, '## Sources') > 0 AS hasSources
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
    WHERE content != ''
  )
)
GROUP BY band
ORDER BY band ASC
FORMAT PrettyCompact`.trim()

export async function run(): Promise<string> {
  return section({
    title: '4. Citation and output-format fidelity',
    question:
      'The skill mandates real-URL inline citations and an Answer / Evidence / Sources section structure. Does the model cite decoratively or ground its claims? Extract the final assistant message, count citation URLs, detect the section headers, compare citations against pages actually read, and bucket by citation count vs. correctness.',
    sql,
    output: await runSql(sql),
  })
}

if (import.meta.main) await process.stdout.write(await run())
