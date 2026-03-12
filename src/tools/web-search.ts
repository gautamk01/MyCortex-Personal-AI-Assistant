import { registerTool } from "./index.js";
import { config } from "../config.js";

// ── Web Search Tool ────────────────────────────────────────────
// Searches the web using DuckDuckGo HTML (no API key needed).
// Falls back gracefully if search fails.

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchDuckDuckGo(query: string, numResults: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo returned ${response.status}`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  // Parse results from DDG HTML response
  // DDG HTML uses <a class="result__a"> for titles/URLs and
  // <a class="result__snippet"> for snippets
  const resultBlocks = html.split("result__body");

  for (let i = 1; i < resultBlocks.length && results.length < numResults; i++) {
    const block = resultBlocks[i];

    // Extract URL and title from result__a
    const linkMatch = block.match(/href="([^"]*)"[^>]*class="result__a"[^>]*>([^<]*)/);
    const linkMatch2 = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)/);
    const link = linkMatch ?? linkMatch2;

    // Extract snippet from result__snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)(?:<\/a>|<\/td>)/);

    if (link) {
      let resultUrl = link[1];
      // DDG wraps URLs in redirect — try to extract the actual URL
      const uddgMatch = resultUrl.match(/uddg=(.*?)(&|$)/);
      if (uddgMatch) {
        resultUrl = decodeURIComponent(uddgMatch[1]);
      }

      results.push({
        title: link[2].replace(/<[^>]*>/g, "").trim(),
        url: resultUrl,
        snippet: snippetMatch
          ? snippetMatch[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim().slice(0, 300)
          : "",
      });
    }
  }

  return results;
}

registerTool({
  name: "web_search",
  description:
    "Search the web and return top results with titles, snippets, and URLs. " +
    "Use this to find current information, research topics, check facts, etc.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
      num_results: {
        type: "number",
        description: "Number of results to return (default: 5, max: 10)",
      },
    },
    required: ["query"],
  },
  execute: async (input) => {
    const query = input.query as string;
    const numResults = Math.min((input.num_results as number) ?? 5, 10);

    try {
      const results = await searchDuckDuckGo(query, numResults);

      if (results.length === 0) {
        return JSON.stringify({
          query,
          results: [],
          message: "No results found. Try rephrasing your search query.",
        });
      }

      return JSON.stringify({ query, results, count: results.length });
    } catch (error) {
      return JSON.stringify({
        error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        suggestion: "Try again or rephrase the query.",
      });
    }
  },
});
