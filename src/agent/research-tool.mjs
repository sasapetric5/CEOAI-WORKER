// One bounded, public, read-only research tool backed by the CEOAI API Connector Registry.
export function createHackerNewsSearchTool({ connectorRegistry } = {}) {
  if (!connectorRegistry || typeof connectorRegistry.execute !== "function") {
    throw new TypeError("API_CONNECTOR_REGISTRY_REQUIRED");
  }
  return Object.freeze({
    id: "hacker_news_search",
    description: "Search public Hacker News discussions. Read-only, no credentials, maximum five concise results.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", maxLength: 120 } },
      required: ["query"],
      additionalProperties: false,
    },
    limits: { maxCalls: 1, timeoutMs: 9000, maxOutputBytes: 7000 },
    async handler({ query }) {
      const result = await connectorRegistry.execute("hacker_news_algolia", "search", { query, hitsPerPage: 5 });
      if (!result.ok) return { ok: false, code: result.code };
      const records = result.records.slice(0, 5).map(record => ({
        ...(typeof record.title === "string" ? { title: record.title.slice(0, 300) } : {}),
        ...(typeof record.url === "string" ? { url: record.url.slice(0, 1000) } : {}),
        ...(typeof record.author === "string" ? { author: record.author.slice(0, 80) } : {}),
        ...(Number.isFinite(record.points) ? { points: record.points } : {}),
        ...(Number.isFinite(record.comments) ? { comments: record.comments } : {}),
        ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt.slice(0, 40) } : {}),
      }));
      return { ok: true, source: "Hacker News / Algolia", count: records.length, totalHits: result.meta.totalHits, records };
    },
  });
}
