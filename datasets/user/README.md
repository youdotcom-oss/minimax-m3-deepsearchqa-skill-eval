# User-supplied evaluation datasets

Put user-owned evaluation cases here only when they are safe to commit. Keep confidential customer cases outside Git and pass them through an explicit local input path when the benchmark runner is configured for them.

## JSONL format

One JSON object per line:

```json
{"id":"case-001","prompt":"Find the latest official information about ...","expected_answer":"...","tags":["web-search"]}
```

- `id` (required): stable case identifier.
- `prompt` (required): the question sent to the agent.
- `expected_answer` (optional): a gold answer for answer grading; omit it for tool, citation, or source-quality checks.
- `tags` (optional): scenario labels used for grouping and filtering.

The example file is intentionally generic. Do not add API keys, private URLs, internal conversation text, or customer-identifying details.
