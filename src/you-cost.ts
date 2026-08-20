import type { JsonObject } from "./io.ts";

const SEARCH_COST_USD_PER_CALL = 5 / 1_000;
const CONTENTS_COST_USD_PER_PAGE = 1 / 1_000;

export interface YouApiCostSummary extends JsonObject {
  searchCalls: number;
  searchExtractionPages: number;
  contentsCalls: number;
  contentsPages: number;
  costUsd: number;
  searchCostUsd: number;
  searchExtractionCostUsd: number;
  contentsCostUsd: number;
}

export function estimateYouApiUsage(
  events: Array<{ type?: string; name?: string; status?: string; input?: JsonObject; output?: JsonObject }>,
): YouApiCostSummary {
  let searchCalls = 0;
  let searchExtractionPages = 0;
  let contentsCalls = 0;
  let contentsPages = 0;

  for (const event of events) {
    if (event.type !== "tool_call") continue;

    if (isYouSearch(event.name) && event.status === "started") {
      searchCalls += 1;
      continue;
    }

    if (isYouSearch(event.name) && event.status === "completed") {
      searchExtractionPages += countSearchExtractionPages(event.output);
      continue;
    }

    if (isYouContents(event.name) && event.status === "started") {
      contentsCalls += 1;
      contentsPages += countUrls(event.input);
    }
  }

  const searchCostUsd = searchCalls * SEARCH_COST_USD_PER_CALL;
  const searchExtractionCostUsd = searchExtractionPages * CONTENTS_COST_USD_PER_PAGE;
  const contentsCostUsd = contentsPages * CONTENTS_COST_USD_PER_PAGE;
  const costUsd = searchCostUsd + searchExtractionCostUsd + contentsCostUsd;

  return {
    searchCalls,
    searchExtractionPages,
    contentsCalls,
    contentsPages,
    costUsd,
    searchCostUsd,
    searchExtractionCostUsd,
    contentsCostUsd,
  };
}

function isYouSearch(name: unknown): boolean {
  return name === "you-search" || name === "you_search";
}

function isYouContents(name: unknown): boolean {
  return name === "you-contents" || name === "you_contents";
}

function countUrls(input: JsonObject | undefined): number {
  const urls = input?.urls;
  return Array.isArray(urls) ? urls.filter((url) => typeof url === "string" && url.length > 0).length : 0;
}

function countSearchExtractionPages(output: JsonObject | undefined): number {
  const root = asObject(output?.details) ?? asObject(output);
  const results = asObject(root?.results);
  if (!results) return 0;

  return countResultsWithContents(results.web) + countResultsWithContents(results.news);
}

function countResultsWithContents(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((result) => {
    const object = asObject(result);
    const contents = asObject(object?.contents);
    return contents !== undefined && Object.keys(contents).length > 0;
  }).length;
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}
