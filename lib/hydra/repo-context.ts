import { promises as fs } from "node:fs";
import path from "node:path";

export interface RepoContextMatch {
  path: string;
  snippet: string;
}

export interface RepoContextQueryResult {
  query: string;
  matches: RepoContextMatch[];
}

export interface RepoContextResponse {
  available: boolean;
  error?: string;
  queries: RepoContextQueryResult[];
}

const REPO_ROOT = process.cwd();
const APP_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), "app");
const LIB_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), "lib");
const ROOT_FILE_PATHS = [
  path.join(/* turbopackIgnore: true */ process.cwd(), "README.md"),
  path.join(/* turbopackIgnore: true */ process.cwd(), "package.json"),
  path.join(/* turbopackIgnore: true */ process.cwd(), "vercel.json"),
  path.join(/* turbopackIgnore: true */ process.cwd(), "tsconfig.json"),
  path.join(/* turbopackIgnore: true */ process.cwd(), "eslint.config.mjs"),
  path.join(/* turbopackIgnore: true */ process.cwd(), "postcss.config.mjs"),
];
const SKIP_DIRS = new Set([".git", ".next", "node_modules", "output", "public", "tmp"]);
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
]);
const STOPWORDS = new Set([
  "a",
  "about",
  "and",
  "are",
  "for",
  "from",
  "how",
  "into",
  "just",
  "that",
  "the",
  "this",
  "with",
  "you",
  "your",
]);
const MAX_FILE_CHARS = 40_000;
const MAX_MATCHES_PER_QUERY = 4;
const SNIPPET_RADIUS = 180;

interface RepoDocument {
  path: string;
  content: string;
  normalizedPath: string;
  normalizedContent: string;
}

async function walkDirectory(dirPath: string, docs: RepoDocument[]) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(absolutePath, docs);
      continue;
    }

    if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    const relativePath = path.relative(REPO_ROOT, absolutePath).replace(/\\/g, "/");
    const content = await fs.readFile(absolutePath, "utf8");
    docs.push({
      path: relativePath,
      content: content.slice(0, MAX_FILE_CHARS),
      normalizedPath: relativePath.toLowerCase(),
      normalizedContent: content.slice(0, MAX_FILE_CHARS).toLowerCase(),
    });
  }
}

async function loadRepoDocuments() {
  const docs: RepoDocument[] = [];

  for (const absoluteRoot of [APP_ROOT, LIB_ROOT]) {
    try {
      const stats = await fs.stat(absoluteRoot);
      if (stats.isDirectory()) {
        await walkDirectory(absoluteRoot, docs);
      }
    } catch {}
  }

  for (const absolutePath of ROOT_FILE_PATHS) {
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isFile()) continue;

      const content = await fs.readFile(absolutePath, "utf8");
      docs.push({
        path: path.basename(absolutePath),
        content: content.slice(0, MAX_FILE_CHARS),
        normalizedPath: path.basename(absolutePath).toLowerCase(),
        normalizedContent: content.slice(0, MAX_FILE_CHARS).toLowerCase(),
      });
    } catch {}
  }

  return docs;
}

function tokenize(query: string) {
  const tokens = query
    .toLowerCase()
    .match(/[a-z0-9_.\/-]{3,}/g)?.filter((token) => !STOPWORDS.has(token)) ?? [];

  return [...new Set(tokens)].slice(0, 12);
}

function buildSnippet(content: string, tokens: string[]) {
  const normalizedContent = content.toLowerCase();
  let index = -1;

  for (const token of tokens) {
    index = normalizedContent.indexOf(token.toLowerCase());
    if (index !== -1) break;
  }

  if (index === -1) {
    return content.replace(/\s+/g, " ").trim().slice(0, SNIPPET_RADIUS * 2);
  }

  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(content.length, index + SNIPPET_RADIUS);
  return content
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();
}

function scoreDocument(doc: RepoDocument, tokens: string[]) {
  let score = 0;

  for (const token of tokens) {
    if (doc.normalizedPath.includes(token)) {
      score += 10;
    }

    const firstMatch = doc.normalizedContent.indexOf(token);
    if (firstMatch !== -1) {
      score += 4;
      const secondMatch = doc.normalizedContent.indexOf(token, firstMatch + token.length);
      if (secondMatch !== -1) {
        score += 1;
      }
    }
  }

  return score;
}

export async function runRepoContextQueries(
  queries: string[]
): Promise<RepoContextResponse> {
  try {
    const docs = await loadRepoDocuments();
    const queryResults = queries.map((query) => {
      const tokens = tokenize(query);
      if (tokens.length === 0) {
        return {
          query,
          matches: [],
        } satisfies RepoContextQueryResult;
      }

      const ranked = docs
        .map((doc) => ({
          doc,
          score: scoreDocument(doc, tokens),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, MAX_MATCHES_PER_QUERY);

      return {
        query,
        matches: ranked.map((item) => ({
          path: item.doc.path,
          snippet: buildSnippet(item.doc.content, tokens),
        })),
      } satisfies RepoContextQueryResult;
    });

    return {
      available: true,
      queries: queryResults,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "Repo context search failed.",
      queries: queries.map((query) => ({ query, matches: [] })),
    };
  }
}
