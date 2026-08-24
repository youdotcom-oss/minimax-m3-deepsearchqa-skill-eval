import { jsonlFile, parseClickHouseCommand } from '../src/query.ts'

/**
 * Read-only guard for SQL handed to `clickhouse-local`. Our analysis queries all
 * start with `SELECT` or a `WITH` CTE; anything else is rejected so no destructive
 * statement reaches the binary. This is the AGENTS.md "keep queries read-only" floor.
 */
// MINIMAL: matches only statements that begin with SELECT/WITH after leading whitespace.
// Ceiling: does not skip leading SQL comments (e.g. `-- note\nSELECT ...`).
// Upgrade path: strip leading `--`/`/* */` comments before testing, if such queries appear.
const READ_ONLY_START = /^(SELECT|WITH)\b/i

export function isReadOnlyQuery(sql: string): boolean {
  return READ_ONLY_START.test(sql.trimStart())
}

export interface QueryTables {
  graded: string
  results: string
  trajectories: string
}

export const tables: QueryTables = {
  graded: jsonlFile('data/graded.jsonl'),
  results: jsonlFile('data/results.jsonl'),
  trajectories: jsonlFile('data/trajectories.jsonl'),
}

/**
 * Run a read-only ClickHouse query via `clickhouse-local` and return PrettyCompact stdout.
 * Resolves the binary from `CLICKHOUSE_LOCAL` (default `clickhouse-local`) through the
 * shared `parseClickHouseCommand` helper. Throws with captured stderr on non-zero exit.
 */
export async function runSql(sql: string): Promise<string> {
  if (!isReadOnlyQuery(sql)) {
    throw new Error(`Refusing to run non-read-only query: ${sql.slice(0, 80)}`)
  }

  const command = [...parseClickHouseCommand(process.env.CLICKHOUSE_LOCAL), '--query', sql]
  const proc = Bun.spawn({ cmd: command, stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  if (exitCode !== 0) {
    throw new Error(`clickhouse-local exited ${exitCode}:\n${stderr}`)
  }
  return stdout
}

export interface SectionParts {
  title: string
  question: string
  sql: string
  output: string
}

/** Render one analysis direction as a markdown section: heading, question, fenced SQL, fenced output. */
export function section(parts: SectionParts): string {
  const fence = '```'
  const output = parts.output.endsWith('\n') ? parts.output : `${parts.output}\n`
  return `## ${parts.title}\n\n${parts.question}\n\n${fence}sql\n${parts.sql}\n${fence}\n\n${fence}text\n${output}${fence}\n\n`
}
