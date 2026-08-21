import { buildClickHousePlan, isQueryPreset, listQueryPresets, parseClickHouseCommand } from '../src/query.ts'

interface QueryCliOptions {
  preset: string
  gradedPath: string
  trajectoriesPath: string
  dryRun: boolean
  list: boolean
  help: boolean
}

const options = parseArgs(process.argv.slice(2))

if (options.help) {
  printHelp()
  process.exit(0)
}

if (options.list) {
  for (const preset of listQueryPresets()) console.log(preset)
  process.exit(0)
}

if (!isQueryPreset(options.preset)) {
  console.error(`Unknown query preset '${options.preset}'. Use --list to see available presets.`)
  process.exit(2)
}

const plan = buildClickHousePlan({
  preset: options.preset,
  gradedPath: options.gradedPath,
  trajectoriesPath: options.trajectoriesPath,
  clickhouseCommand: parseClickHouseCommand(process.env.CLICKHOUSE_LOCAL),
})

if (options.dryRun) {
  console.log(JSON.stringify(plan, null, 2))
  process.exit(0)
}

try {
  const proc = Bun.spawn({
    cmd: plan.command,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  })
  process.exit(await proc.exited)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error("Install clickhouse-local or set CLICKHOUSE_LOCAL, then rerun 'bun run query'.")
  process.exit(1)
}

function parseArgs(args: string[]): QueryCliOptions {
  const options: QueryCliOptions = {
    preset: 'summary',
    gradedPath: 'data/graded.jsonl',
    trajectoriesPath: 'data/trajectories.jsonl',
    dryRun: false,
    list: false,
    help: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    switch (arg) {
      case '--preset':
      case '-p':
        index += 1
        options.preset = readValue(args, index, arg)
        break
      case '--graded-path':
        index += 1
        options.gradedPath = readValue(args, index, arg)
        break
      case '--trajectories-path':
        index += 1
        options.trajectoriesPath = readValue(args, index, arg)
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--list':
        options.list = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        if (arg?.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
        options.preset = arg ?? options.preset
        break
    }
  }

  return options
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index]
  if (value === undefined || value.startsWith('-')) throw new Error(`${flag} requires a value`)
  return value
}

function printHelp(): void {
  console.log(`Usage: bun run query -- [preset] [options]

Query large eval JSONL artifacts with clickhouse-local.

Presets:
  ${listQueryPresets().join('\n  ')}

Options:
  -p, --preset <name>          Query preset to run, defaults to summary
      --graded-path <path>     Graded JSONL path, defaults to data/graded.jsonl
      --trajectories-path <path>
                               Trajectories JSONL path, defaults to data/trajectories.jsonl
      --dry-run                Print the clickhouse-local command and SQL without executing
      --list                   List presets
  -h, --help                   Show this help

Set CLICKHOUSE_LOCAL if your command is not 'clickhouse-local', for example:
  CLICKHOUSE_LOCAL="./clickhouse local" bun run query -- summary`)
}
