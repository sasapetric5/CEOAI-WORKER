// Deterministic research source selection. It never grants tool permissions.
const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;
const SENSITIVE_QUERY_KEY = /(?:token|key|auth|session|password|secret|signature|sig|cookie)/i;
const CYRILLIC_TO_LATIN = {
  а:"a",б:"b",в:"v",г:"g",д:"d",ђ:"dj",е:"e",ж:"z",з:"z",и:"i",ј:"j",к:"k",л:"l",љ:"lj",
  м:"m",н:"n",њ:"nj",о:"o",п:"p",р:"r",с:"s",т:"t",ћ:"c",у:"u",ф:"f",х:"h",ц:"c",ч:"c",џ:"dz",ш:"s",
};

function normalizeIntentText(value) {
  return [...String(value ?? "").toLowerCase()]
    .map(ch => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join("")
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}

export function isExplicitSpiderCrawlRequest(task) {
  const text = normalizeIntentText(task).replace(/\s+/g, " ").trim();
  return /\b(?:crawl(?:ing)?|scrap(?:e|ing)|rept(?:aj|anje|ati)|skini\s+sve\s+stranice|preuzmi\s+sve\s+stranice|skeniraj\s+sajt|crawl\s+site)\b/.test(text) ||
    /\b(?:use|run|start|invoke|call|pokreni|koristi)\s+(?:the\s+)?(?:spider\s+)?crawler\b/.test(text);
}

export function normalizeResearchUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password ||
        !host.includes(".") || host.includes(":") ||
        /^\d+(?:\.\d+){0,3}$/.test(host) ||
        /^(?:localhost|metadata\.google\.internal)$/.test(host) ||
        /\.(?:localhost|local|lan|home|internal|test|invalid|onion|arpa)$/.test(host)) return null;
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractHttpUrl(task) {
  const match = String(task || "").match(URL_PATTERN);
  if (!match) return null;
  return normalizeResearchUrl(match[0].replace(/[),.!?;]+$/, ""));
}

function buildSearchQuery(task) {
  return String(task || "").replace(URL_PATTERN, " ").replace(/\s+/g, " ").trim().slice(0, 400);
}

/**
 * Selects the least expensive available research path.
 * Browser Run requires explicit crawl intent, caller-granted capability,
 * and a remaining daily budget slot.
 */
export function planResearchAcquisition(options = {}) {
  const task = typeof options.task === "string" ? options.task : "";
  const url = extractHttpUrl(task);
  const query = buildSearchQuery(task);
  const crawlRequested = options.browserRunRequested === true;

  if (crawlRequested && url && options.browserRunAuthorized === true &&
      options.browserRunBudgetAvailable === true) {
    return Object.freeze({
      strategy: "browser_run_crawl", url, query,
      fallbackStrategy: options.jinaAvailable === true ? "jina_read" :
        options.freeSearchAvailable === true ? "duckduckgo_search" : null,
      reason: "explicit_crawl_authorized_and_budgeted",
    });
  }
  const blockedCrawlReason = crawlRequested
    ? options.browserRunAuthorized !== true ? "BROWSER_RUN_NOT_AUTHORIZED" :
      options.browserRunBudgetAvailable !== true ? "BROWSER_RUN_DAILY_QUOTA_EXHAUSTED" :
        "BROWSER_RUN_URL_REQUIRED"
    : null;
  if (url && options.jinaAvailable === true) {
    return Object.freeze({
      strategy: "jina_read", url, query,
      fallbackStrategy: options.freeSearchAvailable === true ? "duckduckgo_search" : null,
      reason: blockedCrawlReason || "single_page_read",
    });
  }
  if (options.freeSearchAvailable === true && query.length >= 3) {
    return Object.freeze({
      strategy: "duckduckgo_search", query, fallbackStrategy: null,
      reason: blockedCrawlReason || (url ? "jina_unavailable" : "web_discovery"),
    });
  }
  return Object.freeze({
    strategy: "unavailable", query, fallbackStrategy: null,
    reason: blockedCrawlReason || "NO_RESEARCH_SOURCE_AVAILABLE",
  });
}
