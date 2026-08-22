import { readStringEnv } from '../src/env.ts'
import { writeResultsFromJsonl } from '../src/results.ts'

const GRADED_PATH = readStringEnv('GRADED_PATH', 'data/graded.jsonl')
const RESULTS_PATH = readStringEnv('RESULTS_PATH', 'data/results.jsonl')

if (!(await Bun.file(GRADED_PATH).exists())) {
  throw new Error(`${GRADED_PATH} does not exist; run bun run grade or bun run download first.`)
}

const count = await writeResultsFromJsonl(RESULTS_PATH, GRADED_PATH)
console.error(`Wrote ${count} flat result rows to ${RESULTS_PATH}`)
