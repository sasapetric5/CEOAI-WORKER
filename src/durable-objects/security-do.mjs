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
      if (typeof date !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date) ||
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
