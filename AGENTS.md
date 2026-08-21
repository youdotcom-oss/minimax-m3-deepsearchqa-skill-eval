# Agent guidance

## Runtime

- Use Bun for TypeScript scripts and package commands.
- Use `uv` for Python scripts. The upload flow is `bun run upload`, which runs `uv run scripts/upload.py`.

## Querying large eval artifacts

The JSONL artifacts in `data/` can be multi-GB. Do not read them with whole-file APIs such as `Bun.file(path).text()`, `JSON.parse(await file.text())`, or Python `Path.read_text()`.

For questions about generated or graded data, prefer the ClickHouse helper:

```sh
bun run query -- --list
bun run query -- summary --dry-run
bun run query -- failures
```

The helper uses `clickhouse-local` and curated read-only SQL presets over the JSONL files. Use `--dry-run` before expensive queries to inspect the SQL and command.

Safety guidance:

- Keep queries read-only.
- Do not start ClickHouse TCP or HTTP listeners.
- Do not query remote URLs or external object stores from ClickHouse.
- Avoid `SELECT *` over `trial.trajectory`; prefer aggregates and `LIMIT`.
- If you add query commands, use `Bun.spawn` or Bun Shell with interpolated arguments. Do not pass user-provided SQL through `bash -c`.
