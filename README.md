# MiniMax M3 DeepSearchQA Skill Eval

Evaluates `minimax/minimax-m3` on `google/deepsearchqa` using a Pi agent with the You.com MCP tools `you-search` and `you-contents`.

## Links

- GitHub: https://github.com/youdotcom-oss/minimax-m3-deepsearchqa-skill-eval
- Hugging Face dataset: https://huggingface.co/datasets/youdotcom/minimax-m3-deepsearchqa-skill-eval

## What this publishes

- `prompts.jsonl` — DeepSearchQA prompts in `agent-eval-harness` task format.
- `trajectories.jsonl` — raw `agent-eval-harness` run output.
- `graded.jsonl` — raw `agent-eval-harness` grade output.
- `summary.json` — aggregate raw and adjusted metrics.

Generated files live under local `data/` and are uploaded to the Hugging Face dataset root. They are not committed to GitHub.

The Hugging Face Dataset Viewer is disabled for this repository because `graded.jsonl` and `trajectories.jsonl` are raw harness artifacts with heterogeneous nested records. Use `bun run download` and `bun run query` for local inspection.

## Reproduce

Run with Bun and uv installed:

```sh
bun install
bun run eval
bun run upload
```

`uv` is only used by `bun run upload` to run the Python Hugging Face uploader and install its Python dependencies.

Required environment variables:

```sh
OPENROUTER_API_KEY=...
YDC_API_KEY=...
```

Optional upload settings:

```sh
HF_DATASET_REPO=<your-hf-namespace>/<your-dataset-repo>
HF_REVISION=main
```

## Commands

```sh
bun run scaffold    # DeepSearchQA -> data/prompts.jsonl
bun run generate    # prompts.jsonl -> trajectories.jsonl
bun run grade       # trajectories.jsonl -> graded.jsonl + summary.json
bun run eval        # scaffold + generate + grade
bun run download    # download published artifacts from HF into data/
bun run upload      # upload README.md and data/* to HF
bun run query       # query large JSONL artifacts with clickhouse-local
bun run check       # typecheck + tests
```

## Usage

Start with a one-question smoke run before launching the full eval:

```sh
FORCE=1 LIMIT=1 K=1 CONCURRENCY=1 bun run eval
cat data/summary.json
```

`FORCE=1` clears prior generated artifacts for the command, which is useful when rerunning a smoke after code changes. Without `FORCE=1`, `generate` and `grade` resume from existing `data/` files.

The smoke run validates plumbing. A score of `0` can still be a valid smoke result if the model missed the answer. Check that `process.totalToolCalls` is greater than `0` and that `data/graded.jsonl` does not show `adapter_invalid_result`.

If the smoke succeeds, run the full local eval:

```sh
caffeinate -dimsu bun run eval
```

Then upload the generated artifacts:

```sh
huggingface-cli login
bun run upload
```

The uploader runs through `uv` and uses the official Python `huggingface_hub` client with `hf_xet`, which streams large files and can resume interrupted uploads. It uses your `huggingface-cli login` token, or `HF_TOKEN` if that environment variable is set. For maximum throughput on large artifacts, optionally set:

```sh
HF_XET_HIGH_PERFORMANCE=1
```

To update only the Hugging Face dataset card, without scanning the large artifacts:

```sh
bun run upload -- --card-only
```

The uploader prepends Hugging Face dataset-card metadata to the uploaded `README.md`; the GitHub README intentionally omits that YAML front matter.

## Download published artifacts

To inspect the public results without rerunning the full eval, download the published artifacts into `data/`:

```sh
bun run download -- --dry-run
bun run download -- --yes
```

By default this downloads `summary.json`, `prompts.jsonl`, and `graded.jsonl`. Use `--all` to include the much larger `trajectories.jsonl`:

```sh
bun run download -- --all --yes
```

## Query artifacts

For ad-hoc questions over large `data/*.jsonl` artifacts, use the ClickHouse helper instead of loading JSONL into memory:

```sh
bun run download -- --yes
bun run query -- --list
bun run query -- summary --dry-run
bun run query -- summary
bun run query -- failures
bun run query -- cost-outliers
bun run query -- latency-outliers
```

This requires `clickhouse-local` on `PATH`. If your ClickHouse binary is invoked another way, set `CLICKHOUSE_LOCAL`, for example:

```sh
CLICKHOUSE_LOCAL="./clickhouse local" bun run query -- summary
```

## Defaults

- Model: `minimax/minimax-m3`
- K: `3`
- Generation concurrency: `3`
- Thinking level: `medium`
- Judge: `deepseek/deepseek-v4-flash-0731`
- Judge fallback: `qwen/qwen3.6-flash`
- Adapter stdout cap: `50_000_000` bytes per trial

## Metrics

`summary.json` reports raw metrics over all rows and adjusted metrics excluding ungradable rows with missing gold answers. `exactPassAtK` is task-level: a task passes if any of its `K` trials scores at least `0.8`.

`summary.json` also reports cost:

- `modelCostUsd` from OpenRouter usage metadata.
- `youApiCostUsd` estimated from You.com pricing, currently `$5/1k` Search calls and `$1/1k` full-page extraction or Contents pages.
- `searchExtractionPages` and `searchExtractionCostUsd` for Search `extraction_mode: "full_page"` pages, counted across web and news results.
- `totalCostUsd` as model plus You.com API cost.

`latency.averageEndToEndMs` reports average harness-measured wall time from adapter invocation to final adapter output, using `trial.invocation.durationMs`.

## Result

Full run completed on 2026-08-21 with `minimax/minimax-m3` at `THINKING_LEVEL=medium`, the You.com MCP `you-search` and `you-contents` tools, and a MiniMax-oriented research skill optimized via an auto-research loop over the model, tool surface, and harness combination.

These are eval results and artifact facts, not a paper claim. The uploaded `prompts.jsonl`, `trajectories.jsonl`, `graded.jsonl`, and `summary.json` are the source of record.

### Summary metrics

| Metric | Raw | Adjusted |
| --- | ---: | ---: |
| Trials | 2,700 | 2,688 |
| Tasks | 900 | 896 |
| Average F1 score | 72.84% | 73.17% |
| Pass rate (`score >= 0.8`) | 66.37% | 66.67% |
| Exact pass@3 (`score >= 0.8`) | 83.56% | 83.93% |
| Ungradable trials | 12 | - |
| Ungradable tasks | 4 | - |

### Cost, latency, and tool use

| Metric | Value |
| --- | ---: |
| Total cost | $478.41 |
| Model cost | $328.14 |
| You.com API cost | $150.27 |
| Average cost per trial | $0.177 |
| Average cost per task | $0.532 |
| Average end-to-end latency per trial | 82.5s |
| Total tool calls | 77,286 |
| Average tool calls per trial | 28.62 |
| Search calls | 24,999 |
| Contents calls | 13,641 |

### Paper-aligned view

The DeepSearchQA paper reports single-response F1 plus categorical rates such as Fully Correct and Fully Incorrect. The project summary's `passRate` and `exactPassAtK` are useful operational metrics, but they are not the same as the paper's Fully Correct rate because this repo's pass threshold is `score >= 0.8`.

Using the graded rows to compute paper-style adjusted trial metrics:

| Metric | Value |
| --- | ---: |
| F1 | 73.17% |
| Fully correct (`score = 1.0`) | 56.58% |
| Fully incorrect (`score = 0.0`) | 19.01% |
| Correct with extraneous answers | 11.31% |
| Partially correct | 13.10% |

For context, the DeepSearchQA paper's Table 4 reports GPT-5 High Reasoning at 73.24 F1, Gemini 3 Pro Preview at 76.86 F1, GPT-5 Pro High Reasoning at 78.98 F1, and Gemini Deep Research Agent at 81.90 F1. This run is therefore best described as competitive with the paper's GPT-5 High Reasoning F1 result, while still behind the top Deep Research agents and with a higher fully-incorrect rate than the leaders.
