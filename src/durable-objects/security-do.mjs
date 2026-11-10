// Atomic HMAC nonce store. One Durable Object instance per app ID.
const NONCE_TTL_SECONDS = 600;
const MAX_NONCE_LENGTH = 128;

export class SecurityOrchestratorDO {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/session/claim" && request.method === "POST") {
      let input;
      try { input = await request.json(); } catch { return Response.json({ error: "invalid_request" }, { status: 400 }); }
      const { date, now } = input || {};
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isSafeInteger(now) || Object.keys(input || {}).some(key => !["date", "now"].includes(key))) {
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }
      const result = await this.ctx.storage.transaction(async txn => {
        const current = await txn.get("session-quota");
        const state = current?.date === date ? current : { date, count: 0 };
        if (state.count >= 1000) return { allowed: false, count: state.count, limit: 1000 };
        const next = { date, count: state.count + 1 };
        await txn.put("session-quota", next);
        return { allowed: true, count: next.count, limit: 1000 };
      });
      return Response.json(result, { status: result.allowed ? 200 : 429, headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/tuf/cache/read" && request.method === "POST") {
      try {
        const record = await this.ctx.storage.get("tuf:metadata:v1");
        return Response.json({
          ok: true,
          revision: Number.isSafeInteger(record?.revision) ? record.revision : 0,
          rootVersion: Number.isSafeInteger(record?.rootVersion) ? record.rootVersion : 0,
          cache: record?.cache && typeof record.cache === "object" ? record.cache : {},
        }, { headers: { "Cache-Control": "no-store" } });
      } catch {
        return Response.json({ ok: false, code: "TUF_CACHE_UNAVAILABLE" }, { status: 503 });
      }
    }

    if (url.pathname === "/tuf/cache/commit" && request.method === "POST") {
      let input;
      try {
        const raw = await request.text();
        if (raw.length > 18 * 1024 * 1024) return Response.json({ ok: false, code: "TUF_CACHE_TOO_LARGE" }, { status: 413 });
        input = JSON.parse(raw);
      } catch {
        return Response.json({ ok: false, code: "INVALID_TUF_CACHE_REQUEST" }, { status: 400 });
      }
      const keys = input && typeof input === "object" && !Array.isArray(input)
        ? Object.keys(input) : [];
      if (keys.some(key => !["expectedRevision", "rootVersion", "cache"].includes(key)) ||
          !Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 0 ||
          !Number.isSafeInteger(input?.rootVersion) || input.rootVersion < 1 ||
          !input.cache || typeof input.cache !== "object" || Array.isArray(input.cache)) {
        return Response.json({ ok: false, code: "INVALID_TUF_CACHE_REQUEST" }, { status: 400 });
      }
      const entries = Object.entries(input.cache);
      const validName = name => /^(?:root|timestamp|(?:[0-9]+\.)?(?:snapshot|targets))\.json$|^root_history\/[0-9]+\.root\.json$/.test(name);
      let total = 0;
      if (entries.length < 1 || entries.length > 128) {
        return Response.json({ ok: false, code: "INVALID_TUF_CACHE_ENTRIES" }, { status: 400 });
      }
      for (const [name, encoded] of entries) {
        if (!validName(name) || typeof encoded !== "string" ||
            encoded.length < 4 || encoded.length > 11 * 1024 * 1024 ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
          return Response.json({ ok: false, code: "INVALID_TUF_CACHE_ENTRY" }, { status: 400 });
        }
        total += encoded.length;
        if (total > 16 * 1024 * 1024) return Response.json({ ok: false, code: "TUF_CACHE_TOO_LARGE" }, { status: 413 });
      }
      if (!Object.hasOwn(input.cache, "root.json")) {
        return Response.json({ ok: false, code: "TUF_CACHE_ROOT_REQUIRED" }, { status: 400 });
      }
      try {
        const result = await this.ctx.storage.transaction(async txn => {
          const current = await txn.get("tuf:metadata:v1") || { revision: 0, rootVersion: 0, cache: {} };
          if (current.revision !== input.expectedRevision) return { ok: false, code: "TUF_CACHE_REVISION_CONFLICT", revision: current.revision };
          if (input.rootVersion < current.rootVersion) return { ok: false, code: "TUF_ROOT_ROLLBACK_REJECTED", revision: current.revision };
          const next = {
            revision: current.revision + 1,
            rootVersion: input.rootVersion,
            cache: input.cache,
            updatedAt: Date.now(),
          };
          await txn.put("tuf:metadata:v1", next);
          return { ok: true, revision: next.revision, rootVersion: next.rootVersion };
        });
        return Response.json(result, { status: result.ok ? 200 : 409, headers: { "Cache-Control": "no-store" } });
      } catch {
        return Response.json({ ok: false, code: "TUF_CACHE_PERSISTENCE_FAILED" }, { status: 503 });
      }
    }

    if (url.pathname !== "/nonce/check" || request.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const { appId, nonce, timestamp } = input || {};
    if (
      typeof appId !== "string" ||
      !/^[A-Z][A-Z0-9_-]{1,63}$/.test(appId) ||
      typeof nonce !== "string" ||
      nonce.length < 16 ||
      nonce.length > MAX_NONCE_LENGTH ||
      !/^[A-Za-z0-9_-]+$/.test(nonce) ||
      !Number.isSafeInteger(timestamp)
    ) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) {
      return Response.json({ error: "expired_request" }, { status: 401 });
    }

    const key = `nonce:${appId}:${nonce}`;
    try {
      const accepted = await this.ctx.storage.transaction(async txn => {
        const existing = await txn.get(key);
        if (existing !== undefined) {
          // A nonce is replay-protected for the full accepted clock-skew window plus cleanup margin.
          // Expired records may be replaced; live records remain single-use.
          if (!Number.isSafeInteger(existing) || existing >= now - NONCE_TTL_SECONDS) return false;
          await txn.delete(key);
        }
        await txn.put(key, now);
        return true;
      });
      if (!accepted) return Response.json({ error: "replay" }, { status: 409 });

      // Opportunistic bounded cleanup; expiry is enforced even if cleanup is delayed.
      if (now % 60 === 0) {
        const cutoff = now - NONCE_TTL_SECONDS;
        const old = await this.ctx.storage.list({ prefix: "nonce:", limit: 1000 });
        const expired = [];
        for (const [storedKey, storedAt] of old) {
          if (Number.isSafeInteger(storedAt) && storedAt < cutoff) expired.push(storedKey);
        }
        if (expired.length) await this.ctx.storage.delete(expired);
      }
      return Response.json({ success: true }, { status: 200 });
    } catch {
      return Response.json({ error: "nonce_store_unavailable" }, { status: 503 });
    }
  }
}
