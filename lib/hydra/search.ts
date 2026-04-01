const FIRECRAWL_SEARCH_TIMEOUT_MS = 15_000;
const DEFAULT_FIRECRAWL_API_URL = "http://localhost:3002";

export type SearchRecencyBucket = "recent" | "old" | "unknown";
export type SearchWindow = "recent" | "old" | "any";

export interface SearchDocument {
  id: string;
  title: string;
  url: string;
  description: string;
  source?: string;
  recency: SearchRecencyBucket;
}

export interface SearchQueryResult {
  query: string;
  results: SearchDocument[];
}

export interface SearchResponse {
  available: boolean;
  error?: string;
  queries: SearchQueryResult[];
}

function getFirecrawlBaseUrl() {
  return (process.env.FIRECRAWL_API_URL?.trim() || DEFAULT_FIRECRAWL_API_URL).replace(/\/+$/, "");
}

function getFirecrawlApiKey() {
  return process.env.FIRECRAWL_API_KEY?.trim() ?? "";
}

function formatDateForTbs(value: Date) {
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  const year = value.getFullYear();
  return `${month}/${day}/${year}`;
}

function buildTbs(window: SearchWindow) {
  if (window === "any") return undefined;

  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - 18);

  if (window === "recent") {
    return `cdr:1,cd_min:${formatDateForTbs(cutoff)},cd_max:${formatDateForTbs(today)}`;
  }

  const earliest = new Date("2000-01-01T00:00:00.000Z");
  const dayBeforeCutoff = new Date(cutoff);
  dayBeforeCutoff.setDate(dayBeforeCutoff.getDate() - 1);

  return `cdr:1,cd_min:${formatDateForTbs(earliest)},cd_max:${formatDateForTbs(dayBeforeCutoff)}`;
}

function toNonEmptyString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDocument(
  value: unknown,
  queryIndex: number,
  resultIndex: number,
  window: SearchWindow
): SearchDocument | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const metadata =
    typeof record.metadata === "object" && record.metadata !== null
      ? (record.metadata as Record<string, unknown>)
      : null;
  const url = toNonEmptyString(record.url);
  const title =
    toNonEmptyString(record.title) ||
    toNonEmptyString(metadata?.title);
  const description =
    toNonEmptyString(record.description) ||
    toNonEmptyString(record.markdown) ||
    toNonEmptyString(metadata?.description);

  if (!url || !title) return null;

  return {
    id: `Q${queryIndex + 1}-${resultIndex + 1}`,
    title,
    url,
    description,
    source: toNonEmptyString(metadata?.sourceURL) || undefined,
    recency: window === "any" ? "unknown" : window,
  };
}

async function runFirecrawlQuery(query: string, queryIndex: number, window: SearchWindow) {
  const body: Record<string, unknown> = {
    query,
    limit: 5,
  };

  const tbs = buildTbs(window);
  if (tbs) {
    body.tbs = tbs;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const apiKey = getFirecrawlApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${getFirecrawlBaseUrl()}/v2/search`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(FIRECRAWL_SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl search failed with status ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const rootData =
    typeof data.data === "object" && data.data !== null
      ? (data.data as Record<string, unknown>)
      : null;
  const rawResults = Array.isArray(rootData?.web)
    ? rootData.web
    : Array.isArray(rootData?.results)
      ? rootData.results
      : Array.isArray(data.web)
        ? data.web
        : [];
  const results = rawResults
    .map((item, resultIndex) => normalizeDocument(item, queryIndex, resultIndex, window))
    .filter((item): item is SearchDocument => item !== null);

  return {
    query,
    results,
  } satisfies SearchQueryResult;
}

export async function runSearchQueries(
  queries: string[],
  window: SearchWindow = "any"
): Promise<SearchResponse> {
  try {
    const settled = await Promise.allSettled(
      queries.map((query, index) => runFirecrawlQuery(query, index, window))
    );

    const queryResults = settled.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }

      return {
        query: queries[index],
        results: [],
      } satisfies SearchQueryResult;
    });

    const hadError = settled.some((result) => result.status === "rejected");

    return {
      available: !hadError,
      error: hadError ? "One or more Firecrawl search queries failed." : undefined,
      queries: queryResults,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "Firecrawl search failed.",
      queries: queries.map((query) => ({ query, results: [] })),
    };
  }
}
