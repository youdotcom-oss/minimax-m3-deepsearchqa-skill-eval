# MiniMax M3 DeepSearchQA Skill Eval

Evaluates `minimax/minimax-m3` on `google/deepsearchqa` using a Pi agent, You.com MCP tools, and a research skill optimized for this harness, model, and tool surface.

**MiniMax M3 Medium Reasoning with the You.com research skill reached 74.85% adjusted F1 on DeepSearchQA, above the paper's GPT-5 High Reasoning F1 result. Public artifacts are available for inspection and reproduction.**

## Links

- GitHub: https://github.com/youdotcom-oss/minimax-m3-deepsearchqa-skill-eval
- Hugging Face dataset: https://huggingface.co/datasets/youdotcom/minimax-m3-deepsearchqa-skill-eval

## Project overview

This repository is an end-to-end evaluation project for `minimax/minimax-m3` on Google's
`deepsearchqa` dataset. It combines a research Skill, You.com MCP search/content tools, a Pi-based
agent adapter, a generation pipeline, and grading/upload scripts.

The main flow is:

```text
DeepSearchQA dataset
        │
        ▼
scaffold ──► prompts.jsonl ──► generate ──► trajectories.jsonl
                                                │
                                                ▼
                                      grade ──► graded.jsonl + summary.json
                                                │
                                                ▼
                                      export/upload ──► public artifacts
```

## Repository structure

```text
.
├── src/                              Core adapter, grader, MCP/session integration
├── scripts/                          Scaffold, generate, grade, export, download, query, upload
├── datasets/
│   ├── public/                       Public dataset provenance and documentation
│   └── user/                         User-supplied input format and safe example
├── integrations/minimax-code/
│   ├── README.md                     MiniMax Code setup and smoke-test guide
│   ├── plugin/                       Portable you-web Plugin package
│   └── smoke-prompts/                Search, contents, and installed-Plugin test prompts
├── .minimax/skills/you-web/          Project-level MiniMax Code Skill
├── data/                             Local generated artifacts; not committed
├── package.json                      Bun scripts and dependencies
└── README.md                         Project overview, results, reproduction, and publishing
```

The project-level Skill and portable Plugin contain the same `you-web` workflow. The former is
loaded when MiniMax Code opens this repository; the latter can be installed and used from any
working directory.

## Quick start

Install dependencies, configure the required credentials locally, and run a one-question smoke:

```sh
bun install
OPENROUTER_API_KEY=... YDC_API_KEY=... FORCE=1 LIMIT=1 K=1 CONCURRENCY=1 bun run eval
cat data/summary.json
```

Use `bun run check` for local code checks. See [Reproduce](#reproduce) for the full evaluation and
[MiniMax Code integration](#minimax-code-integration) for the Skill/Plugin workflow.

## Results

Full run completed on 2026-09-09 with `minimax/minimax-m3` at `THINKING_LEVEL=medium`, the You.com MCP `you-search` and `you-contents` tools, and a MiniMax-oriented research skill optimized via an auto-research loop over the model, tool surface, and harness combination.

These are eval results and artifact facts, not a paper claim. The uploaded `prompts.jsonl`, `results.jsonl`, `trajectories.jsonl`, `graded.jsonl`, and `summary.json` are the source of record.

| Metric | Value |
| --- | ---: |
| Adjusted F1 score | 74.85% |
| Adjusted pass rate (`score >= 0.8`) | 67.30% |
| Adjusted exact pass@3 (`score >= 0.8`) | 83.59% |
| Fully correct (`score = 1.0`) | 57.90% |
| Trials | 2,700 |
| Tasks | 900 |
| Total cost | $399.83 |
| P50 / P95 latency | 50.9s / 388.5s |

### Summary metrics

| Metric | Raw | Adjusted |
| --- | ---: | ---: |
| Trials | 2,700 | 2,688 |
| Tasks | 900 | 896 |
| Average F1 score | 74.52% | 74.85% |
| Pass rate (`score >= 0.8`) | 67.00% | 67.30% |
| Exact pass@3 (`score >= 0.8`) | 83.22% | 83.59% |
| Ungradable trials | 12 | - |
| Ungradable tasks | 4 | - |

### Cost, latency, and tool use

Cost totals:

| Metric | Value |
| --- | ---: |
| Total cost | $399.83 |
| Model cost | $290.53 |
| You.com API cost | $109.30 |
| Average cost per task | $0.444 |

Per-trial distributions:

| Metric | Average | P50 | P90 | P95 |
| --- | ---: | ---: | ---: | ---: |
| Cost | $0.148 | $0.078 | $0.383 | $0.533 |
| End-to-end latency | 98.5s | 50.9s | 231.1s | 388.5s |
| Tool calls | 19.82 | 14 | 44 | 58 |

Tool call totals:

| Metric | Value |
| --- | ---: |
| Total tool calls | 53,590 |
| Search calls | 19,049 |
| Contents calls | 7,745 |

## Benchmark context

The DeepSearchQA paper reports single-response F1 plus categorical rates such as Fully Correct and Fully Incorrect. The project summary's `passRate` and `exactPassAtK` are useful operational metrics, but they are not the same as the paper's Fully Correct rate because this repo's pass threshold is `score >= 0.8`.

Using the graded rows to compute paper-style adjusted trial metrics:

| Metric | Value |
| --- | ---: |
| F1 | 74.85% |
| Fully correct (`score = 1.0`) | 57.90% |
| Fully incorrect (`score = 0.0`) | 16.66% |
| Correct with extraneous answers | 13.98% |
| Partially correct | 11.45% |

For context, the DeepSearchQA paper's Table 4 reports GPT-5 High Reasoning at 73.24 F1, Gemini 3 Pro Preview at 76.86 F1, GPT-5 Pro High Reasoning at 78.98 F1, and Gemini Deep Research Agent at 81.90 F1. This run is therefore best described as above the paper's GPT-5 High Reasoning F1 result, while still behind the top Deep Research agents and with a higher fully-incorrect rate than the leaders.

## Eval setup

- Dataset: `google/deepsearchqa`
- Model: `minimax/minimax-m3`
- K: `3`
- Generation concurrency: `3`
- Thinking level: `medium`
- Tools: You.com MCP `you-search` and `you-contents`
- Judge: `deepseek/deepseek-v4-flash-0731`
- Judge fallback: `qwen/qwen3.6-flash`
- Adapter stdout cap: `50_000_000` bytes per trial

## Evidence artifacts

- `prompts.jsonl` — DeepSearchQA prompts in `agent-eval-harness` task format.
- `results.jsonl` — flat, viewer-safe per-trial result rows derived from `graded.jsonl`.
- `trajectories.jsonl` — raw `agent-eval-harness` run output.
- `graded.jsonl` — raw `agent-eval-harness` grade output.
- `summary.json` — aggregate raw and adjusted metrics.

Generated files live under local `data/` and are uploaded to the Hugging Face dataset root. They are not committed to GitHub.

The uploaded Hugging Face dataset card configures the Dataset Viewer to load stable, flat `results.jsonl` rows and `prompts.jsonl` prompts. The raw `graded.jsonl` and `trajectories.jsonl` harness artifacts remain downloadable, but are intentionally excluded from the viewer because they contain heterogeneous nested records.

## Inspect published results

To inspect the public results without rerunning the full eval, download the published artifacts into `data/`:

```sh
bun run download -- --dry-run
bun run download -- --yes
```

By default this downloads `summary.json`, `prompts.jsonl`, `results.jsonl`, and `graded.jsonl`. Use `--all` to include the much larger `trajectories.jsonl`:

```sh
bun run download -- --all --yes
```

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

## Reproduce

Run with Bun and uv installed:

```sh
bun install
bun run eval
bun run export-results
bun run upload
```

`uv` is used by `bun run upload` and `bun run download` to run the Python Hugging Face scripts and install their Python dependencies.

Required environment variables:

```sh
OPENROUTER_API_KEY=...
YDC_API_KEY=...
```

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
bun run export-results
bun run upload
```

## Commands

```sh
bun run scaffold    # DeepSearchQA -> data/prompts.jsonl
bun run generate    # prompts.jsonl -> trajectories.jsonl
bun run grade       # trajectories.jsonl -> graded.jsonl + summary.json
bun run eval        # scaffold + generate + grade
bun run export-results # graded.jsonl -> results.jsonl
bun run download    # download published artifacts from HF into data/
bun run upload      # upload README.md and data/* to HF
bun run query       # query large JSONL artifacts with clickhouse-local
bun run check       # typecheck + tests
```

## Metrics definitions

`summary.json` reports raw metrics over all rows and adjusted metrics excluding ungradable rows with missing gold answers. `exactPassAtK` is task-level: a task passes if any of its `K` trials scores at least `0.8`.

`summary.json` also reports cost:

- `modelCostUsd` from OpenRouter usage metadata.
- `youApiCostUsd` estimated from You.com pricing, currently `$5/1k` Search calls and `$1/1k` full-page extraction or Contents pages.
- `searchExtractionPages` and `searchExtractionCostUsd` for Search `extraction_mode: "full_page"` pages, counted across web and news results. Highlights-mode search results are included in the per-call Search price and are not billed as extraction pages.
- `totalCostUsd` as model plus You.com API cost.

`latency.averageEndToEndMs` reports average harness-measured wall time from adapter invocation to final adapter output, using `trial.invocation.durationMs`.

## Publishing to Hugging Face

Optional upload settings:

```sh
HF_DATASET_REPO=<your-hf-namespace>/<your-dataset-repo>
HF_REVISION=main
```

The uploader runs through `uv` and uses the official Python `huggingface_hub` client with `hf_xet`, which streams large files and can resume interrupted uploads. Full artifact uploads require a current `data/results.jsonl`; run `bun run export-results` after grading and before upload. The uploader uses your `huggingface-cli login` token, or `HF_TOKEN` if that environment variable is set. For maximum throughput on large artifacts, optionally set:

```sh
HF_XET_HIGH_PERFORMANCE=1
```

To update only the Hugging Face dataset card, without scanning the large artifacts:

```sh
bun run upload -- --card-only
```

The uploader prepends Hugging Face dataset-card metadata to the uploaded `README.md`; the GitHub README intentionally omits that YAML front matter. The uploaded dataset card configures the Hugging Face Dataset Viewer to use `results.jsonl` and `prompts.jsonl`, while leaving the raw `graded.jsonl` and `trajectories.jsonl` artifacts downloadable.

## License

MIT. The generated Hugging Face dataset card declares `license: mit`.

## MiniMax Code integration

This repository also provides a project Skill for local MiniMax Code at `.minimax/skills/you-web/SKILL.md`. It reuses the focused You.com workflow for `you-search` and `you-contents`.

See the [MiniMax Code integration guide](integrations/minimax-code/README.md) for project-level MCP setup, and the [portable Plugin guide](integrations/minimax-code/plugin/README.md) for installation from an arbitrary directory. The reproducible installed-Plugin test is in [plugin-acceptance.md](integrations/minimax-code/smoke-prompts/plugin-acceptance.md).

The MCP server used by this project is:

```text
https://api.you.com/mcp?tools=you-search,you-contents
```

Keep authentication in local environment or local MCP configuration. Do not commit API keys, customer data, or private evaluation cases.
