// CEOAI integration registry — capability contracts only.
// These adapters are intentionally NOT active until a separately hosted service,
// authentication method, and bounded request contract are implemented and tested.
// Never put service tokens in this registry or return them in status output.

const DEFINITIONS = [
  { id: "lychee", name: "Lychee", capability: "broken-link-check", execution: "external-runner", configPrefix: "CEOAI_LYCHEE", requires: ["runner endpoint", "runner authentication", "bounded URL/page scope"], output: ["checked", "broken", "skipped", "errors"], freeSelfHosted: true, cloudflareWorkerNative: false },
  { id: "unlighthouse", name: "Unlighthouse", capability: "performance-audit", execution: "external-runner", configPrefix: "CEOAI_UNLIGHTHOUSE", requires: ["browser-capable runner", "runner authentication", "bounded URL/page scope"], output: ["lighthouse reports", "performance metrics", "audit errors"], freeSelfHosted: true, cloudflareWorkerNative: false },
  { id: "serpbear", name: "SerpBear", capability: "search-ranking-history", execution: "external-service", configPrefix: "CEOAI_SERPBEAR", requires: ["self-hosted SerpBear service", "authenticated API", "keyword/domain scope"], output: ["keyword", "position", "checkedAt", "source"], freeSelfHosted: true, cloudflareWorkerNative: false },
  { id: "umami", name: "Umami", capability: "privacy-focused-analytics", execution: "external-service", configPrefix: "CEOAI_UMAMI", requires: ["self-hosted Umami", "website identifier", "least-privilege analytics credential"], output: ["aggregated visits", "page views", "date range", "source"], freeSelfHosted: true, cloudflareWorkerNative: false },
  { id: "crawl4ai", name: "Crawl4AI", capability: "ai-ready-page-extraction", execution: "external-service", configPrefix: "CEOAI_CRAWL4AI", requires: ["self-hosted Crawl4AI", "API token", "URL allowlist", "response size/time limits"], output: ["markdown", "metadata", "crawl status"], freeSelfHosted: true, cloudflareWorkerNative: false },
];

const cloneDefinition = (definition) => ({ ...definition, requires: [...definition.requires], output: [...definition.output] });

function isSafeServiceEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname.includes(".") || hostname.length > 253) return false;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
        hostname.endsWith(".internal") || hostname.endsWith(".test") || hostname.endsWith(".invalid")) return false;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.startsWith("[") || hostname === "metadata.google.internal") return false;
    if (hostname.split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return false;
    return true;
  } catch {
    return false;
  }
}

export function listIntegrationDefinitions() {
  return DEFINITIONS.map(cloneDefinition);
}

export function getIntegrationDefinition(id) {
  const definition = DEFINITIONS.find((item) => item.id === id);
  return definition ? cloneDefinition(definition) : null;
}

// Reports implementation readiness without exposing URLs, credentials, or secret values.
// A module is always disabled until code-level support and explicit runtime opt-in exist.
export function getIntegrationReadiness(id, env = {}) {
  const definition = DEFINITIONS.find((item) => item.id === id);
  if (!definition) return { id, known: false, enabled: false, status: "UNKNOWN_INTEGRATION" };

  const prefix = definition.configPrefix;
  const optedIn = env[prefix + "_ENABLED"] === "true";
  const endpoint = env[prefix + "_URL"];
  const hasEndpoint = isSafeServiceEndpoint(endpoint);
  const token = env[prefix + "_TOKEN"];
  const hasCredential = typeof token === "string" && token.trim().length > 0;

  let status = "NOT_CONFIGURED";
  if (optedIn && hasEndpoint && hasCredential) status = "CONFIG_PRESENT_NOT_IMPLEMENTED";
  else if (optedIn) status = "INCOMPLETE_CONFIGURATION";

  return {
    id: definition.id,
    known: true,
    enabled: false,
    status,
    requiresExternalRuntime: true,
    endpointConfigured: hasEndpoint,
    credentialConfigured: hasCredential,
    note: "No outbound request is made by this registry. Integration remains inactive until its adapter is implemented and tested.",
  };
}
