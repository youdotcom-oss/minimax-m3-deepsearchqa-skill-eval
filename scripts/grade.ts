import { dirname } from 'node:path'
import { isForce, readIntegerEnv, readStringEnv } from '../src/env.ts'
import { appendFileContents, ensureDir, removeIfExists, runCommandToFile, writeJsonl } from '../src/io.ts'
import { writeSummaryFromJsonl } from '../src/summary.ts'
import {
  collectLatestRowLines,
  collectRowKeys,
  streamChunksForHarness,
  streamLatestRows,
  trialRowKey,
} from '../src/trial-rows.ts'

const TRAJECTORIES_PATH = readStringEnv('TRAJECTORIES_PATH', 'data/trajectories.jsonl')
const GRADED_PATH = readStringEnv('GRADED_PATH', 'data/graded.jsonl')
const SUMMARY_PATH = readStringEnv('SUMMARY_PATH', 'data/summary.json')
const TMP_TRIALS_PATH = readStringEnv('TMP_GRADE_TRIALS_PATH', '.tmp/grade-trials.jsonl')
const TMP_OUTPUT_PATH = readStringEnv('TMP_GRADE_OUTPUT_PATH', '.tmp/grade-output.jsonl')
const K = readIntegerEnv('K', 3, 1)
const CONCURRENCY =
  process.env.GRADE_CONCURRENCY === undefined || process.env.GRADE_CONCURRENCY === ''
    ? readIntegerEnv('CONCURRENCY', 3, 1)
    : readIntegerEnv('GRADE_CONCURRENCY', 3, 1)
const MODEL = readStringEnv('MODEL', 'minimax/minimax-m3')
const GRADER_TIMEOUT_MS = readIntegerEnv('GRADER_TIMEOUT_MS', 240_000, 1)
const GRADE_CHUNK_MAX_BYTES = readIntegerEnv('GRADE_CHUNK_MAX_BYTES', 250_000_000, 1)

await main()

async function main(): Promise<void> {
  if (!(await Bun.file(TRAJECTORIES_PATH).exists()))
    throw new Error(`${TRAJECTORIES_PATH} does not exist; run bun run generate first.`)
  await ensureDir(dirname(GRADED_PATH))
  await ensureDir(dirname(TMP_TRIALS_PATH))
  const latestTrajectoryLines = await collectLatestRowLines(TRAJECTORIES_PATH)
  const gradedKeys = isForce() ? new Set<string>() : await collectRowKeys(GRADED_PATH)

  if (isForce()) await removeIfExists(GRADED_PATH)
  let gradedCount = 0
  let chunkIndex = 0
  for await (const chunk of streamChunksForHarness(
    pendingTrajectories(latestTrajectoryLines, gradedKeys),
    GRADE_CHUNK_MAX_BYTES,
  )) {
    chunkIndex += 1
    await writeJsonl(TMP_TRIALS_PATH, chunk)
    await removeIfExists(TMP_OUTPUT_PATH)
    const input = {
      mode: 'grade',
      trialsPath: TMP_TRIALS_PATH,
      concurrency: CONCURRENCY,
      graders: [
        { id: 'process', type: 'process', weight: 0.1 },
        {
          id: 'deepsearchqa-answer',
          type: 'command',
          when: 'completed',
          weight: 1,
          options: {
            command: ['bun', 'run', 'src/grader.ts'],
            output: 'grader_json',
            timeoutMs: GRADER_TIMEOUT_MS,
            maxOutputBytes: 500_000,
          },
        },
      ],
    }
    console.error(`Grading chunk ${chunkIndex} (${chunk.length} trajectories) with concurrency=${CONCURRENCY}`)
    await runCommandToFile(['bunx', 'agent-eval-harness', 'eval', JSON.stringify(input)], TMP_OUTPUT_PATH)
    await appendFileContents(GRADED_PATH, TMP_OUTPUT_PATH)
    gradedCount += chunk.length
  }

  if (gradedCount === 0) {
    console.error(`No grading work left. ${GRADED_PATH} already has grades for all trajectories.`)
  }

  const summary = await writeSummaryFromJsonl(SUMMARY_PATH, GRADED_PATH, { k: K, model: MODEL })
  console.error(
    `Wrote ${SUMMARY_PATH}: raw avg=${summary.raw.averageScore.toFixed(4)}, adjusted avg=${summary.adjusted.averageScore.toFixed(4)}`,
  )
}

async function* pendingTrajectories(
  latestTrajectoryLines: Map<string, number>,
  gradedKeys: Set<string>,
): AsyncGenerator<Record<string, unknown>> {
  for await (const row of streamLatestRows(TRAJECTORIES_PATH, latestTrajectoryLines)) {
    const key = trialRowKey(row)
    if (key && !gradedKeys.has(key)) yield row
  }
}
