// Queue producer/consumer for the existing shared CEOAI Browser Run Spider.
import { createBrowserRunCrawler, normalizeBrowserRunUrl } from "./browser-run-crawler.mjs";

const MAX_PAGES = 20;
const MAX_DEPTH = 2;
const DAILY_JOB_LIMIT = 5;
const POLL_DELAY_SECONDS = 60;
const MAX_POLL_ATTEMPTS = 60;
const RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const START_TERMINAL_ERRORS = new Set([
  "CRAWL_AUTH_FAILED", "CRAWL_JOB_NOT_FOUND", "CRAWL_REQUEST_REJECTED",
  "CRAWL_URL_REJECTED", "CRAWL_PAGE_LIMIT_REJECTED", "CRAWL_DEPTH_REJECTED",
  "CRAWL_RATE_LIMITED",
]);
const TERMINAL_STATUSES = new Set([
  "cancelled_due_to_timeout", "cancelled_due_to_limits", "cancelled_by_user", "errored",
]);

function validPageLimit(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_PAGES;
}
function validDepth(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DEPTH;
}
function utcDate(now) {
  return new Date(now).toISOString().slice(0, 10);
}
function safeError(error, fallback = "SPIDER_PROCESSING_FAILED") {
  const code = error?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : fallback;
}

export async function enqueueSpiderCrawl(env, {
  url, pageLimit = 10, depth = 1, jobId = crypto.randomUUID(),
} = {}) {
  if (!env?.SPIDER_QUEUE || typeof env.SPIDER_QUEUE.send !== "function") return { ok: false, code: "SPIDER_QUEUE_UNAVAILABLE" };
  const safeUrl = normalizeBrowserRunUrl(url);
  if (!safeUrl) return { ok: false, code: "CRAWL_URL_REJECTED" };
  if (!validPageLimit(pageLimit)) return { ok: false, code: "CRAWL_PAGE_LIMIT_REJECTED" };
  if (!validDepth(depth)) return { ok: false, code: "CRAWL_DEPTH_REJECTED" };
  if (typeof jobId !== "string" || !JOB_ID.test(jobId)) return { ok: false, code: "INVALID_SPIDER_JOB_ID" };
  try {
    await env.SPIDER_QUEUE.send({
      version: 1, kind: "start", id: jobId, url: safeUrl,
      pageLimit, depth, queuedAt: Date.now(),
    });
    return { ok: true, jobId, status: "queued" };
  } catch {
    return { ok: false, code: "SPIDER_QUEUE_PUBLISH_FAILED" };
  }
}

function createLedger(env) {
  if (!env?.SPIDER_LEDGER || typeof env.SPIDER_LEDGER.idFromName !== "function" ||
      typeof env.SPIDER_LEDGER.get !== "function") throw new Error("SPIDER_LEDGER_UNAVAILABLE");
  return async (name, path, input) => {
    const stub = env.SPIDER_LEDGER.get(env.SPIDER_LEDGER.idFromName(name));
    const response = await stub.fetch("https://spider-ledger.internal" + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    let data;
    try { data = await response.json(); } catch { throw new Error("SPIDER_LEDGER_INVALID_RESPONSE"); }
    if (!response.ok || data?.ok !== true) throw new Error(data?.code || "SPIDER_LEDGER_UNAVAILABLE");
    return data;
  };
}

function validateMessage(body) {
  if (!plain(body) || body.version !== 1 || typeof body.kind !== "string" || !JOB_ID.test(body.id || "")) return null;
  if (body.kind === "start") {
    if (Object.keys(body).some(key => !["version", "kind", "id", "url", "pageLimit", "depth", "queuedAt"].includes(key)) ||
        typeof body.url !== "string" || !normalizeBrowserRunUrl(body.url) ||
        !validPageLimit(body.pageLimit) || !validDepth(body.depth) ||
        !Number.isSafeInteger(body.queuedAt)) return null;
    return { kind: "start", id: body.id, url: normalizeBrowserRunUrl(body.url), pageLimit: body.pageLimit, depth: body.depth };
  }
  if (body.kind === "poll") {
    if (Object.keys(body).some(key => !["version", "kind", "id", "attempt"].includes(key)) ||
        !Number.isSafeInteger(body.attempt) || body.attempt < 0 || body.attempt > MAX_POLL_ATTEMPTS) return null;
    return { kind: "poll", id: body.id, attempt: body.attempt };
  }
  return null;
}

function makeCrawler(env, factory) {
  if (typeof env?.SPIDER_BROWSER_RUN_ACCOUNT_ID !== "string" ||
      typeof env?.SPIDER_BROWSER_RUN_TOKEN !== "string") throw new Error("SPIDER_BROWSER_RUN_CONFIG_MISSING");
  return factory({
    accountId: env.SPIDER_BROWSER_RUN_ACCOUNT_ID,
    apiToken: env.SPIDER_BROWSER_RUN_TOKEN,
  });
}

export function createSpiderQueueHandler({
  createCrawler = options => createBrowserRunCrawler(options),
  now = () => Date.now(),
} = {}) {
  if (typeof createCrawler !== "function" || typeof now !== "function") throw new TypeError("INVALID_SPIDER_QUEUE_DEPENDENCY");

  async function processStart(message, env, ledger) {
    const claimed = await ledger("job:" + message.id, "/job/claim-start", {
      id: message.id, url: message.url, pageLimit: message.pageLimit, depth: message.depth, now: now(),
    });
    const state = claimed.state;
    if (!claimed.claimed) {
      if (!state) throw new Error("SPIDER_JOB_STATE_MISSING");
      if (state.status === "running") {
        await env.SPIDER_QUEUE.send({ version: 1, kind: "poll", id: message.id, attempt: 0 }, { delaySeconds: POLL_DELAY_SECONDS });
        return;
      }
      if (["completed", "failed", "start_unknown"].includes(state.status)) return;
      throw Object.assign(new Error("SPIDER_START_IN_PROGRESS"), { code: "SPIDER_START_IN_PROGRESS" });
    }

    const quota = await ledger("quota:" + utcDate(now()), "/quota/claim", {
      date: utcDate(now()), id: message.id, limit: DAILY_JOB_LIMIT, now: now(),
    });
    if (!quota.allowed) {
      await ledger("job:" + message.id, "/job/mark-failed", {
        id: message.id, code: "SPIDER_DAILY_LIMIT_REACHED", now: now(),
      });
      return;
    }

    let crawler;
    try { crawler = makeCrawler(env, createCrawler); }
    catch {
      await ledger("job:" + message.id, "/job/mark-failed", {
        id: message.id, code: "SPIDER_CONFIGURATION_MISSING", now: now(),
      });
      return;
    }

    let started;
    try { started = await crawler.startCrawl({ url: message.url, pageLimit: message.pageLimit, depth: message.depth }); }
    catch {
      await ledger("job:" + message.id, "/job/mark-unknown", {
        id: message.id, code: "CRAWL_START_OUTCOME_UNKNOWN", now: now(),
      });
      return;
    }
    if (!started?.ok) {
      const code = safeError(started, "CRAWL_START_FAILED");
      const route = START_TERMINAL_ERRORS.has(code) ? "/job/mark-failed" : "/job/mark-unknown";
      await ledger("job:" + message.id, route, { id: message.id, code, now: now() });
      return;
    }

    await ledger("job:" + message.id, "/job/mark-running", {
      id: message.id, browserJobId: started.jobId, now: now(),
    });
    // If publishing the poll message fails, the original start message is retried.
    // Its durable running state prevents a second Browser Run POST.
    await env.SPIDER_QUEUE.send({
      version: 1, kind: "poll", id: message.id, attempt: 0,
    }, { delaySeconds: POLL_DELAY_SECONDS });
  }

  async function processPoll(message, env, ledger) {
    const found = await ledger("job:" + message.id, "/job/get", { id: message.id });
    const state = found.state;
    if (!state) throw new Error("SPIDER_JOB_STATE_MISSING");
    if (["completed", "failed", "start_unknown"].includes(state.status)) return;
    if (state.status === "starting") throw Object.assign(new Error("SPIDER_START_IN_PROGRESS"), { code: "SPIDER_START_IN_PROGRESS" });
    if (state.status !== "running" || !state.browserJobId) throw new Error("SPIDER_JOB_STATE_INVALID");

    let crawler;
    try { crawler = makeCrawler(env, createCrawler); }
    catch { throw new Error("SPIDER_CONFIGURATION_MISSING"); }
    const status = await crawler.getStatus(state.browserJobId);
    if (!status?.ok) {
      const code = safeError(status, "CRAWL_STATUS_UNAVAILABLE");
      if (["CRAWL_AUTH_FAILED", "CRAWL_JOB_NOT_FOUND", "CRAWL_REQUEST_REJECTED"].includes(code)) {
        await ledger("job:" + message.id, "/job/mark-failed", { id: message.id, code, now: now() });
        return;
      }
      throw Object.assign(new Error(code), { code });
    }
    if (status.status === "running") {
      if (message.attempt >= MAX_POLL_ATTEMPTS) {
        await ledger("job:" + message.id, "/job/mark-failed", {
          id: message.id, code: "CRAWL_POLL_WINDOW_EXHAUSTED", now: now(),
        });
        return;
      }
      await env.SPIDER_QUEUE.send({
        version: 1, kind: "poll", id: message.id, attempt: message.attempt + 1,
      }, { delaySeconds: POLL_DELAY_SECONDS });
      return;
    }
    if (status.status !== "completed") {
      if (TERMINAL_STATUSES.has(status.status)) {
        await ledger("job:" + message.id, "/job/mark-failed", {
          id: message.id, code: "CRAWL_" + status.status.toUpperCase(), now: now(),
        });
        return;
      }
      throw new Error("CRAWL_UNKNOWN_STATUS");
    }

    const results = await crawler.getResults(state.browserJobId, { limit: state.pageLimit });
    if (!results?.ok || results.status !== "completed" || !Array.isArray(results.records)) {
      throw new Error(safeError(results, "CRAWL_RESULTS_UNAVAILABLE"));
    }
    if (!env.KV_MEMORY || typeof env.KV_MEMORY.put !== "function") throw new Error("SPIDER_RESULT_STORE_UNAVAILABLE");
    const resultKey = "spider:result:" + message.id;
    const resultDocument = {
      version: 1, jobId: message.id, sourceUrl: state.url,
      browserJobId: state.browserJobId, completedAt: new Date(now()).toISOString(),
      count: results.records.length, records: results.records,
      meta: { total: results.total ?? null, finished: results.finished ?? null },
      trust: "untrusted_reference",
    };
    const encoded = JSON.stringify(resultDocument);
    if (new TextEncoder().encode(encoded).byteLength > 512_000) throw new Error("SPIDER_RESULT_TOO_LARGE");
    await env.KV_MEMORY.put(resultKey, encoded, { expirationTtl: RESULT_TTL_SECONDS });
    await ledger("job:" + message.id, "/job/mark-complete", {
      id: message.id, resultKey, recordCount: results.records.length, now: now(),
    });
  }

  return async function queue(batch, env) {
    if (!batch || !Array.isArray(batch.messages)) throw new TypeError("INVALID_QUEUE_BATCH");
    let ledger;
    try { ledger = createLedger(env); }
    catch {
      for (const message of batch.messages) message.retry({ delaySeconds: 60 });
      return;
    }
    for (const message of batch.messages) {
      const validated = validateMessage(message?.body);
      if (!validated) {
        message.ack();
        console.warn("CEOAI_SPIDER", JSON.stringify({ event: "invalid_message_dropped" }));
        continue;
      }
      try {
        if (!env?.SPIDER_QUEUE || typeof env.SPIDER_QUEUE.send !== "function") throw new Error("SPIDER_QUEUE_UNAVAILABLE");
        if (validated.kind === "start") await processStart(validated, env, ledger);
        else await processPoll(validated, env, ledger);
        message.ack();
      } catch (error) {
        const code = safeError(error);
        console.warn("CEOAI_SPIDER", JSON.stringify({ event: "message_retry", code }));
        message.retry({ delaySeconds: 60 });
      }
    }
  };
}
