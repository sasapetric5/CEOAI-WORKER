// Cloudflare-managed Spider bridge for CEOAI V5.
// Queue -> Browser Run /crawl -> KV state/results.
// This adapter preserves the ceoai-spider/1 result envelope. The actual
// remote fetch engine is Cloudflare Browser Run, not the native Rust Spider
// HTTP client; this distinction is returned in execution metadata.

import { parseApprovedSourceHosts, validateCrawlTarget } from "./web-intelligence.mjs";
import { validateSpiderJobResult } from "./spider-adapter-contract.mjs";

const PROTOCOL = "ceoai-spider/1";
const MAX_PAGES = 10;                 // Deliberately below Cloudflare Free's 100-page ceiling.
const MAX_DEPTH = 2;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_MARKDOWN_CHARS = 20_000;
const JOB_TTL_SECONDS = 60 * 60 * 24;

function validJobId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(value);
}

function boundedInt(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function validateCloudflareSpiderInput(input, env = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { accepted: false, errors: ["body-must-be-object"] };
  }
  const approvedHosts = parseApprovedSourceHosts(env.SPIDER_APPROVED_HOSTS || "");
  const target = validateCrawlTarget(input.url, approvedHosts);
  if (!target.allowed) return { accepted: false, errors: [target.reason] };

  if (input.page_limit !== undefined && (!Number.isInteger(input.page_limit) || input.page_limit < 1 || input.page_limit > MAX_PAGES)) {
    return { accepted: false, errors: ["page-limit-out-of-range"] };
  }
  if (input.depth !== undefined && (!Number.isInteger(input.depth) || input.depth < 0 || input.depth > MAX_DEPTH)) {
    return { accepted: false, errors: ["depth-out-of-range"] };
  }
  const pageLimit = input.page_limit ?? 5;
  const depth = input.depth ?? 1;
  const render = input.render === true;
  if (render && env.SPIDER_RENDER_JS_ENABLED !== "true") {
    return { accepted: false, errors: ["javascript-rendering-not-enabled"] };
  }
  if (input.render !== undefined && typeof input.render !== "boolean") {
    return { accepted: false, errors: ["render-must-be-boolean"] };
  }

  return {
    accepted: true,
    errors: [],
    request: {
      protocol: PROTOCOL,
      job_id: `spider_${crypto.randomUUID()}`,
      adapter_id: "spider",
      url: target.canonical_url,
      hostname: target.hostname,
      page_limit: pageLimit,
      depth,
      render,
      external_actions: false,
      paid_services: false,
    },
  };
}

async function readJsonBounded(response, maxBytes = 64 * 1024) {
  const declared = Number(response.headers.get("Content-Length") || "0");
  if (declared > maxBytes) throw new Error("cloudflare-response-too-large");
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("cloudflare-response-too-large");
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("response-size-limit");
        throw new Error("cloudflare-response-too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function cloudflareApiConfig(env) {
  const accountId = typeof env.CLOUDFLARE_ACCOUNT_ID === "string" ? env.CLOUDFLARE_ACCOUNT_ID.trim() : "";
  const token = typeof env.BROWSER_RUN_API_TOKEN === "string" ? env.BROWSER_RUN_API_TOKEN.trim() : "";
  if (!/^[a-f0-9]{32}$/i.test(accountId) || token.length < 20) {
    throw new Error("browser-run-not-configured");
  }
  return {
    base: `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-run/crawl`,
    token,
  };
}

function apiHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function storeJob(env, jobId, value) {
  await env.KV_MEMORY.put(`spider:job:${jobId}`, JSON.stringify(value), {
    expirationTtl: JOB_TTL_SECONDS,
  });
}

function publicJob(job) {
  const { owner_session, cloudflare_job_id, ...safe } = job;
  return safe;
}

async function reserveDailyJobSlot(env, jobId) {
  // Queue consumer max_concurrency=1 serializes this KV read/modify/write.
  const day = new Date().toISOString().slice(0, 10);
  const countKey = `spider:daily:${day}`;
  const reservationKey = `spider:daily:reservation:${jobId}`;
  if (await env.KV_MEMORY.get(reservationKey)) return true;
  const used = Number(await env.KV_MEMORY.get(countKey) || "0");
  if (!Number.isSafeInteger(used) || used >= 5) return false;
  await env.KV_MEMORY.put(countKey, String(used + 1), { expirationTtl: JOB_TTL_SECONDS });
  await env.KV_MEMORY.put(reservationKey, "1", { expirationTtl: JOB_TTL_SECONDS });
  return true;
}

export async function enqueueCloudflareSpiderJob(env, input, sessionId) {
  if (env.SPIDER_CLOUDFLARE_ENABLED !== "true") {
    return { accepted: false, status: 503, error: "spider-cloudflare-disabled" };
  }
  if (!env.SPIDER_QUEUE || typeof env.SPIDER_QUEUE.send !== "function") {
    return { accepted: false, status: 503, error: "spider-queue-not-configured" };
  }
  try { cloudflareApiConfig(env); } catch {
    return { accepted: false, status: 503, error: "browser-run-not-configured" };
  }

  const validated = validateCloudflareSpiderInput(input, env);
  if (!validated.accepted) return { accepted: false, status: 400, errors: validated.errors };
  const request = validated.request;
  const state = {
    protocol: PROTOCOL,
    job_id: request.job_id,
    adapter_id: "spider",
    owner_session: sessionId,
    source_url: request.url,
    hostname: request.hostname,
    status: "queued",
    created_at: new Date().toISOString(),
    page_limit: request.page_limit,
    depth: request.depth,
    render: request.render,
    external_actions: false,
    paid_services: false,
    engine: "cloudflare-browser-run",
  };

  try {
    await storeJob(env, request.job_id, state);
    await env.SPIDER_QUEUE.send({
      protocol: PROTOCOL,
      job_id: request.job_id,
      url: request.url,
      hostname: request.hostname,
      page_limit: request.page_limit,
      depth: request.depth,
      render: request.render,
      owner_session: sessionId,
    });
  } catch {
    try { await storeJob(env, request.job_id, { ...state, status: "enqueue_failed" }); } catch {}
    return { accepted: false, status: 503, error: "spider-queue-unavailable" };
  }

  return {
    accepted: true,
    status: 202,
    job: {
      protocol: PROTOCOL,
      job_id: request.job_id,
      adapter_id: "spider",
      status: "queued",
      engine: "cloudflare-browser-run",
      page_limit: request.page_limit,
      render: request.render,
      external_actions: false,
      paid_services: false,
    },
  };
}

async function startBrowserRunJob(env, message) {
  const { base, token } = cloudflareApiConfig(env);
  const payload = {
    url: message.url,
    limit: boundedInt(message.page_limit, 5, 1, MAX_PAGES),
    depth: boundedInt(message.depth, 1, 0, MAX_DEPTH),
    formats: ["markdown"],
    render: message.render === true,
    source: "all",
    options: {
      includeExternalLinks: false,
      includeSubdomains: false,
    },
  };
  const response = await fetch(base, {
    method: "POST",
    headers: apiHeaders(token),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await readJsonBounded(response, 64 * 1024);
  if (!response.ok || data?.success !== true || typeof data.result !== "string") {
    const error = new Error("browser-run-create-failed");
    error.retryable = response.status === 429;
    throw error;
  }
  return data.result;
}

export async function processCloudflareSpiderQueue(batch, env) {
  for (const message of batch.messages || []) {
    const body = message.body;
    if (!body || body.protocol !== PROTOCOL || !validJobId(body.job_id)) {
      message.ack();
      continue;
    }
    try {
      const existing = await env.KV_MEMORY.get(`spider:job:${body.job_id}`, "json");
      if (!existing || existing.status !== "queued" || existing.owner_session !== body.owner_session) {
        message.ack();
        continue;
      }
      const approved = validateCrawlTarget(body.url, env.SPIDER_APPROVED_HOSTS || "");
      if (!approved.allowed || approved.hostname !== body.hostname) {
        await storeJob(env, body.job_id, { ...existing, status: "rejected", error: "source-host-not-approved" });
        message.ack();
        continue;
      }
      const hasDailySlot = await reserveDailyJobSlot(env, body.job_id);
      if (!hasDailySlot) {
        await storeJob(env, body.job_id, { ...existing, status: "daily_free_limit_reached", error: "free-daily-crawl-limit-reached" });
        message.ack();
        continue;
      }
      const browserRunJobId = await startBrowserRunJob(env, body);
      await storeJob(env, body.job_id, {
        ...existing,
        status: "running",
        cloudflare_job_id: browserRunJobId,
        started_at: new Date().toISOString(),
      });
      message.ack();
    } catch (error) {
      if (error?.retryable) {
        message.retry({ delaySeconds: 30 });
        continue;
      }
      try {
        const existing = await env.KV_MEMORY.get(`spider:job:${body.job_id}`, "json");
        if (existing) await storeJob(env, body.job_id, { ...existing, status: "failed", error: "browser-run-start-failed" });
      } catch {}
      message.ack();
    }
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function normalizeBrowserRunRecords(result, job) {
  const approvedHosts = [job.hostname];
  const records = [];
  const rejected = [];
  for (const item of Array.isArray(result.records) ? result.records.slice(0, job.page_limit) : []) {
    const target = validateCrawlTarget(item?.url, approvedHosts);
    if (!target.allowed || item?.status !== "completed") {
      rejected.push({ url: String(item?.url || "").slice(0, 2048), status: item?.status || "unknown" });
      continue;
    }
    const httpStatus = Number(item?.metadata?.status);
    if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
      rejected.push({ url: target.canonical_url, status: "http-error" });
      continue;
    }
    const markdown = typeof item.markdown === "string" ? item.markdown.slice(0, MAX_MARKDOWN_CHARS) : "";
    if (!markdown.trim()) {
      rejected.push({ url: target.canonical_url, status: "empty-content" });
      continue;
    }
    const title = typeof item.metadata?.title === "string" ? item.metadata.title.slice(0, 500) : "";
    records.push({
      source_url: target.canonical_url,
      collected_at: new Date().toISOString(),
      http_status: httpStatus,
      robots_allowed: true,
      extractor: "cloudflare-browser-run/markdown",
      content_hash: await sha256Hex(markdown),
      evidence: [markdown.slice(0, 2000)],
      data: { title, markdown },
    });
  }
  return { records, rejected };
}

async function fetchBrowserRunResult(env, browserRunJobId) {
  const { base, token } = cloudflareApiConfig(env);
  const response = await fetch(`${base}/${encodeURIComponent(browserRunJobId)}?limit=${MAX_PAGES}`, {
    headers: apiHeaders(token),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await readJsonBounded(response, MAX_RESULT_BYTES);
  if (!response.ok || data?.success !== true || !data.result) {
    throw new Error("browser-run-result-failed");
  }
  return data.result;
}

export async function getCloudflareSpiderJob(env, jobId, sessionId) {
  if (!validJobId(jobId)) return { status: 400, body: { success: false, error: "invalid-job-id" } };
  let job;
  try { job = await env.KV_MEMORY.get(`spider:job:${jobId}`, "json"); } catch {
    return { status: 503, body: { success: false, error: "spider-storage-unavailable" } };
  }
  if (!job || job.owner_session !== sessionId) {
    return { status: 404, body: { success: false, error: "spider-job-not-found" } };
  }
  if (job.status !== "running" || !job.cloudflare_job_id) {
    return { status: job.status === "queued" ? 202 : 200, body: { success: true, job: publicJob(job) } };
  }

  try {
    const result = await fetchBrowserRunResult(env, job.cloudflare_job_id);
    if (result.status === "running") {
      return { status: 202, body: { success: true, job: publicJob({ ...job, status: "running", progress: { total: result.total || 0, finished: result.finished || 0 } }) } };
    }
    if (result.status !== "completed") {
      const failed = { ...job, status: "failed", error: String(result.status || "browser-run-failed") };
      await storeJob(env, jobId, failed);
      return { status: 200, body: { success: true, job: publicJob(failed) } };
    }

    const normalized = await normalizeBrowserRunRecords(result, job);
    const protocolResult = {
      protocol: PROTOCOL,
      job_id: jobId,
      adapter_id: "spider",
      records: normalized.records,
      errors: normalized.rejected.map(item => `${item.status}:${item.url}`),
      external_actions: false,
      paid_services: false,
      execution: {
        mode: "cloudflare-managed-async-crawl",
        engine: "cloudflare-browser-run",
        runtime: "cloudflare-workers-queue",
        robots_enforcement: "cloudflare-browser-run",
        browser_rendering: job.render,
        total_pages: result.total || 0,
        finished_pages: result.finished || 0,
        browser_seconds_used: Number(result.browserSecondsUsed || 0),
      },
    };
    const validated = validateSpiderJobResult(protocolResult, { approvedHosts: [job.hostname], now: Date.now() });
    protocolResult.records = validated.records;
    protocolResult.errors = [...protocolResult.errors, ...validated.errors];
    protocolResult.validation_status = validated.execution_status;
    const completed = { ...job, status: "completed", completed_at: new Date().toISOString(), result: protocolResult };
    await storeJob(env, jobId, completed);
    return { status: 200, body: { success: true, job: publicJob(completed) } };
  } catch {
    return { status: 503, body: { success: false, error: "browser-run-result-unavailable" } };
  }
}

export async function handleCloudflareSpiderRequest(request, env, sessionId) {
  const url = new URL(request.url);
  if (url.pathname === "/api/crawl" && request.method === "POST") {
    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return Response.json({ success: false, error: "expected-json" }, { status: 415, headers: { "Cache-Control": "no-store" } });
    }
    const declared = Number(request.headers.get("Content-Length") || "0");
    if (declared > 8_192) return Response.json({ success: false, error: "request-too-large" }, { status: 413 });
    let input;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 8_192) throw new Error("too-large");
      input = JSON.parse(text);
    } catch {
      return Response.json({ success: false, error: "invalid-json-or-body-too-large" }, { status: 400 });
    }
    const result = await enqueueCloudflareSpiderJob(env, input, sessionId);
    return Response.json(result, { status: result.status || (result.accepted ? 202 : 400), headers: { "Cache-Control": "no-store" } });
  }

  const match = url.pathname.match(/^\/api\/crawl\/([a-zA-Z0-9_-]{8,100})$/);
  if (match && request.method === "GET") {
    const result = await getCloudflareSpiderJob(env, match[1], sessionId);
    return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}

export const CLOUDFLARE_SPIDER_LIMITS = Object.freeze({
  maxPages: MAX_PAGES,
  maxDepth: MAX_DEPTH,
  maxResultBytes: MAX_RESULT_BYTES,
  maxMarkdownChars: MAX_MARKDOWN_CHARS,
  jobTtlSeconds: JOB_TTL_SECONDS,
  defaultRender: false,
  externalActions: false,
  paidServices: false,
});
