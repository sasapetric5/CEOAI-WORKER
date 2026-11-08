// Atomic, idempotent ledger and daily quota gate for asynchronous Spider jobs.
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const QUOTA_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const START_LEASE_MS = 120_000;
const APP_ID = /^[A-Z][A-Z0-9_-]{1,63}$/;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});
const fail = (code, status = 400) => json({ ok: false, code }, status);

export class SpiderJobLedgerDO {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.method !== "POST") return fail("METHOD_NOT_ALLOWED", 405);
    const path = new URL(request.url).pathname;
    let input;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 16_384) return fail("REQUEST_TOO_LARGE", 413);
      input = JSON.parse(raw);
    } catch {
      return fail("INVALID_JSON");
    }
    if (!plain(input)) return fail("INVALID_REQUEST");

    try {
      if ((path.startsWith("/job/") || path === "/quota/claim" || path === "/quota/claim-combined") && !APP_ID.test(input.appId || "")) return fail("INVALID_APP_ID");
      if (path === "/job/claim-start") return await this.claimStart(input);
      if (path === "/job/get") return await this.getJob(input);
      if (path === "/job/mark-running") return await this.markRunning(input);
      if (path === "/job/mark-unknown") return await this.markUnknown(input);
      if (path === "/job/mark-failed") return await this.markFailed(input);
      if (path === "/job/mark-complete") return await this.markComplete(input);
      if (path === "/quota/claim") return await this.claimQuota(input);
      if (path === "/quota/claim-combined") return await this.claimCombinedQuota(input);
      return fail("NOT_FOUND", 404);
    } catch {
      return fail("LEDGER_UNAVAILABLE", 503);
    }
  }

  async claimStart(input) {
    if (!JOB_ID.test(input.id || "") || typeof input.url !== "string" || input.url.length > 2048 ||
        !Number.isSafeInteger(input.pageLimit) || input.pageLimit < 1 || input.pageLimit > 20 ||
        !Number.isSafeInteger(input.depth) || input.depth < 0 || input.depth > 2 ||
        !Number.isSafeInteger(input.now) || input.now < 0 ||
        Object.keys(input).some(key => !["appId", "id", "url", "pageLimit", "depth", "now"].includes(key))) {
      return fail("INVALID_JOB");
    }
    const result = await this.ctx.storage.transaction(async txn => {
      let state = await txn.get("state");
      if (!state) {
        state = {
          version: 1, appId: input.appId, id: input.id, url: input.url, pageLimit: input.pageLimit, depth: input.depth,
          status: "starting", createdAt: input.now, updatedAt: input.now,
          browserJobId: null, errorCode: null, resultKey: null, recordCount: 0,
        };
        await txn.put("state", state);
        return { claimed: true, state };
      }
      if (state.appId !== input.appId || state.id !== input.id || state.url !== input.url ||
          state.pageLimit !== input.pageLimit || state.depth !== input.depth) {
        return { claimed: false, conflict: true };
      }
      if (state.status === "starting" && input.now - state.updatedAt >= START_LEASE_MS) {
        state = { ...state, status: "start_unknown", errorCode: "START_OUTCOME_UNKNOWN", updatedAt: input.now };
        await txn.put("state", state);
      }
      return { claimed: false, state };
    });
    if (result.claimed) await this.ctx.storage.setAlarm(input.now + JOB_TTL_MS);
    return json({ ok: true, ...result });
  }

  async getJob(input) {
    if (!JOB_ID.test(input.id || "") || Object.keys(input).some(key => !["appId", "id"].includes(key))) return fail("INVALID_JOB");
    const state = await this.ctx.storage.get("state");
    if (!state || state.appId !== input.appId || state.id !== input.id) return json({ ok: true, state: null });
    return json({ ok: true, state });
  }

  async markRunning(input) {
    if (!JOB_ID.test(input.id || "") || typeof input.browserJobId !== "string" ||
        !/^[A-Za-z0-9_-]{8,80}$/.test(input.browserJobId) || !Number.isSafeInteger(input.now) ||
        Object.keys(input).some(key => !["appId", "id", "browserJobId", "now"].includes(key))) return fail("INVALID_JOB");
    const result = await this.ctx.storage.transaction(async txn => {
      const state = await txn.get("state");
      if (!state || state.appId !== input.appId || state.id !== input.id) return { ok: false, code: "JOB_NOT_FOUND" };
      if (state.status === "running" && state.browserJobId === input.browserJobId) return { ok: true, state };
      if (state.status !== "starting") return { ok: false, code: "INVALID_JOB_TRANSITION" };
      const next = { ...state, status: "running", browserJobId: input.browserJobId, updatedAt: input.now };
      await txn.put("state", next);
      return { ok: true, state: next };
    });
    if (result.ok) await this.ctx.storage.setAlarm(input.now + JOB_TTL_MS);
    return json(result, result.ok ? 200 : 409);
  }

  async markUnknown(input) {
    if (!JOB_ID.test(input.id || "") || typeof input.code !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.code) || !Number.isSafeInteger(input.now) ||
        Object.keys(input).some(key => !["appId", "id", "code", "now"].includes(key))) return fail("INVALID_JOB");
    const result = await this.ctx.storage.transaction(async txn => {
      const state = await txn.get("state");
      if (!state || state.appId !== input.appId || state.id !== input.id) return { ok: false, code: "JOB_NOT_FOUND" };
      if (state.status === "start_unknown") return { ok: true, state };
      if (state.status !== "starting") return { ok: false, code: "INVALID_JOB_TRANSITION" };
      const next = { ...state, status: "start_unknown", errorCode: input.code, updatedAt: input.now };
      await txn.put("state", next);
      return { ok: true, state: next };
    });
    return json(result, result.ok ? 200 : 409);
  }

  async markFailed(input) {
    if (!JOB_ID.test(input.id || "") || typeof input.code !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.code) || !Number.isSafeInteger(input.now) ||
        Object.keys(input).some(key => !["appId", "id", "code", "now"].includes(key))) return fail("INVALID_JOB");
    const result = await this.ctx.storage.transaction(async txn => {
      const state = await txn.get("state");
      if (!state || state.appId !== input.appId || state.id !== input.id) return { ok: false, code: "JOB_NOT_FOUND" };
      if (state.status === "failed") return { ok: true, state };
      if (!["starting", "running"].includes(state.status)) return { ok: false, code: "INVALID_JOB_TRANSITION" };
      const next = { ...state, status: "failed", errorCode: input.code, updatedAt: input.now };
      await txn.put("state", next);
      return { ok: true, state: next };
    });
    return json(result, result.ok ? 200 : 409);
  }

  async markComplete(input) {
    if (!JOB_ID.test(input.id || "") || typeof input.resultKey !== "string" ||
        !/^spider:result:[A-Z0-9_-]{2,64}:[0-9a-f-]{36}$/i.test(input.resultKey) ||
        !Number.isSafeInteger(input.recordCount) || input.recordCount < 0 || input.recordCount > 20 ||
        !Number.isSafeInteger(input.now) ||
        Object.keys(input).some(key => !["appId", "id", "resultKey", "recordCount", "now"].includes(key))) return fail("INVALID_JOB");
    const result = await this.ctx.storage.transaction(async txn => {
      const state = await txn.get("state");
      if (!state || state.appId !== input.appId || state.id !== input.id) return { ok: false, code: "JOB_NOT_FOUND" };
      if (state.status === "completed" && state.resultKey === input.resultKey) return { ok: true, state };
      if (state.status !== "running") return { ok: false, code: "INVALID_JOB_TRANSITION" };
      const next = {
        ...state, status: "completed", resultKey: input.resultKey,
        recordCount: input.recordCount, updatedAt: input.now,
      };
      await txn.put("state", next);
      return { ok: true, state: next };
    });
    if (result.ok) await this.ctx.storage.setAlarm(input.now + JOB_TTL_MS);
    return json(result, result.ok ? 200 : 409);
  }

  async claimQuota(input) {
    if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
        !JOB_ID.test(input.id || "") || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 5 ||
        !Number.isSafeInteger(input.now) || Object.keys(input).some(key => !["appId", "date", "id", "limit", "now"].includes(key))) {
      return fail("INVALID_QUOTA_REQUEST");
    }
    const result = await this.ctx.storage.transaction(async txn => {
      const existing = await txn.get("quota") || { appId: input.appId, date: input.date, count: 0, jobIds: [] };
      if (existing.appId !== input.appId || existing.date !== input.date) return { ok: false, code: "QUOTA_DATE_MISMATCH" };
      if (existing.jobIds.includes(input.id)) return { ok: true, allowed: true, duplicate: true, count: existing.count, limit: input.limit };
      if (existing.count >= input.limit) return { ok: true, allowed: false, duplicate: false, count: existing.count, limit: input.limit };
      const next = { ...existing, count: existing.count + 1, jobIds: [...existing.jobIds, input.id] };
      await txn.put("quota", next);
      return { ok: true, allowed: true, duplicate: false, count: next.count, limit: input.limit };
    });
    if (result.ok) await this.ctx.storage.setAlarm(input.now + QUOTA_TTL_MS);
    return json(result);
  }

  async claimCombinedQuota(input) {
    const appLimits = { "CONTENTCRAFT-APP": 3, "AIFORCE-APP": 2, "RANKGEO-APP": 2 };
    if (input.appId !== "GLOBAL" || !Object.hasOwn(appLimits, input.quotaAppId) ||
        typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
        !JOB_ID.test(input.id || "") || input.appLimit !== appLimits[input.quotaAppId] ||
        input.globalLimit !== 5 || !Number.isSafeInteger(input.now) || input.now < 0 ||
        Object.keys(input).some(key => !["appId", "quotaAppId", "date", "id", "appLimit", "globalLimit", "now"].includes(key))) {
      return fail("INVALID_QUOTA_REQUEST");
    }
    const result = await this.ctx.storage.transaction(async txn => {
      const existing = await txn.get("quota") || { appId: "GLOBAL", date: input.date, count: 0, jobIds: [] };
      if (existing.appId !== "GLOBAL" || existing.date !== input.date) return { ok: false, code: "QUOTA_DATE_MISMATCH" };
      const appCounts = existing.appCounts && typeof existing.appCounts === "object" ? existing.appCounts : {};
      const appJobIds = existing.appJobIds && typeof existing.appJobIds === "object" ? existing.appJobIds : {};
      const globalJobIds = Array.isArray(existing.jobIds) ? existing.jobIds.filter(key => String(key).includes(":")) : [];
      const ownIds = Array.isArray(appJobIds[input.quotaAppId]) ? appJobIds[input.quotaAppId] : [];
      const jobKey = input.quotaAppId + ":" + input.id;
      if (globalJobIds.includes(jobKey) || ownIds.includes(input.id)) return { ok: true, allowed: true, duplicate: true, count: existing.count, appCount: appCounts[input.quotaAppId] || 0 };
      const globalCount = Number.isSafeInteger(existing.count) && existing.count >= 0 ? existing.count : 0;
      const appCount = Number.isSafeInteger(appCounts[input.quotaAppId]) && appCounts[input.quotaAppId] >= 0 ? appCounts[input.quotaAppId] : 0;
      if (globalCount >= input.globalLimit) return { ok: true, allowed: false, reason: "GLOBAL_DAILY_LIMIT_REACHED", count: globalCount, appCount };
      if (appCount >= input.appLimit) return { ok: true, allowed: false, reason: "APP_DAILY_LIMIT_REACHED", count: globalCount, appCount };
      const next = { appId: "GLOBAL", date: input.date, count: globalCount + 1, jobIds: [...globalJobIds, jobKey],
        appCounts: { ...appCounts, [input.quotaAppId]: appCount + 1 },
        appJobIds: { ...appJobIds, [input.quotaAppId]: [...ownIds, input.id] } };
      await txn.put("quota", next);
      return { ok: true, allowed: true, duplicate: false, count: next.count, appCount: appCount + 1 };
    });
    if (result.ok) await this.ctx.storage.setAlarm(input.now + QUOTA_TTL_MS);
    return json(result);
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
