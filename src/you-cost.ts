import type { JsonObject } from './io.ts'

const SEARCH_COST_USD_PER_CALL = 5 / 1_000
const PAGE_EXTRACTION_COST_USD_PER_PAGE = 1 / 1_000

export interface YouApiCostSummary extends JsonObject {
  searchCalls: number
  searchExtractionPages: number
  contentsCalls: number
  contentsPages: number
  costUsd: number
  searchCostUsd: number
  searchExtractionCostUsd: number
  contentsCostUsd: number
}

export function estimateYouApiUsage(events: ReadonlyArray<Record<string, unknown>>): YouApiCostSummary {
  let searchCalls = 0
  let searchExtractionPages = 0
  let contentsCalls = 0
  let contentsPages = 0

  for (const event of events) {
    if (event.type !== 'tool_call') continue

    if (isYouSearch(event.name) && event.status === 'started') {
      searchCalls += 1
      continue
    }

    if (isYouSearch(event.name) && event.status === 'completed') {
      searchExtractionPages += countSearchExtractionPages(asObject(event.output))
      continue
    }

    if (isYouContents(event.name) && event.status === 'started') {
      contentsCalls += 1
      contentsPages += countUrls(asObject(event.input))
    }
  }

  const searchCostUsd = searchCalls * SEARCH_COST_USD_PER_CALL
  const searchExtractionCostUsd = searchExtractionPages * PAGE_EXTRACTION_COST_USD_PER_PAGE
  const contentsCostUsd = contentsPages * PAGE_EXTRACTION_COST_USD_PER_PAGE
  const costUsd = searchCostUsd + searchExtractionCostUsd + contentsCostUsd

  return {
    searchCalls,
    searchExtractionPages,
    contentsCalls,
    contentsPages,
    costUsd,
    searchCostUsd,
    searchExtractionCostUsd,
    contentsCostUsd,
  }
}

function isYouSearch(name: unknown): boolean {
  return name === 'you-search' || name === 'you_search'
}

// Cost summary for a harness trial row. Recomputes from the trial's embedded
// trajectory events so exports stay consistent when the estimator changes;
// falls back to the generation-time `metadata.youApiUsage` when the row has
// no trajectory (e.g. truncated artifacts).
export function youApiUsageForTrial(trial: Record<string, unknown> | undefined): Record<string, unknown> {
  const trajectory = trial?.trajectory
  if (Array.isArray(trajectory)) {
    return estimateYouApiUsage(trajectory.map((event) => asObject(event) ?? {}))
  }
  return asObject(asObject(trial?.metadata)?.youApiUsage) ?? {}
}

function isYouContents(name: unknown): boolean {
  return name === 'you-contents' || name === 'you_contents'
}

function countUrls(input: JsonObject | undefined): number {
  const urls = input?.urls
  return Array.isArray(urls) ? urls.filter((url) => typeof url === 'string' && url.length > 0).length : 0
}

function countSearchExtractionPages(output: JsonObject | undefined): number {
  const root = asObject(output?.details) ?? asObject(output)
  const results = asObject(root?.results)
  if (!results) return 0

  return countResultsWithFullPageContents(results.web) + countResultsWithFullPageContents(results.news)
}

// Search full_page extraction is billed per extracted web/news result.
// Under `extraction_mode: "full_page"` the API returns crawled page content in
// `contents.markdown` / `contents.html`. Highlights mode (the default) also
// populates `contents`, but only with `highlights` passages, which are free —
// so only html/markdown contents count as billed extraction pages.
function countResultsWithFullPageContents(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return value.filter((result) => {
    const contents = asObject(asObject(result)?.contents)
    if (contents === undefined) return false
    return (
      (typeof contents.markdown === 'string' && contents.markdown.length > 0) ||
      (typeof contents.html === 'string' && contents.html.length > 0)
    )
  }).length
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined
}
