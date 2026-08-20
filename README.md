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

## Reproduce

Run inside a Daytona sandbox or another clean Linux environment with Bun installed:

```sh
bun install
bun run eval:upload
```

Required environment variables:

```sh
OPENROUTER_API_KEY=...
YDC_API_KEY=...
HF_TOKEN=...
HF_DATASET_REPO=youdotcom/minimax-m3-deepsearchqa-skill-eval
```

## Commands

```sh
bun run scaffold    # DeepSearchQA -> data/prompts.jsonl
bun run generate    # prompts.jsonl -> trajectories.jsonl
bun run grade       # trajectories.jsonl -> graded.jsonl + summary.json
bun run eval        # scaffold + generate + grade
bun run upload      # upload README.md and data/* to HF
bun run eval:upload # eval + upload
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
bun run upload
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
