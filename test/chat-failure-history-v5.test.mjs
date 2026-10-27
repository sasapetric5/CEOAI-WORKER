import test from "node:test";
import assert from "node:assert/strict";
import worker from "../ceoai-index-v5.0.mjs";

class MemoryKV {
  constructor() { this.data = new Map(); }
  async get(key, type) {
    const value = this.data.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key, value) { this.data.set(key, String(value)); }
  async delete(key) { this.data.delete(key); }
}

test("failed provider attempts never append the user turn to persisted chat history", async () => {
  const kv = new MemoryKV();
  const env = {
    KV_MEMORY: kv,
    RATE_LIMITER: { async limit() { return { success: true }; } },
    AI_ENABLED: "true",
    EXTERNAL_AI_ENABLED: "true",
    OPENROUTER_FREE_CONFIRMED: "true",
    OPENROUTER_KEY: "test-openrouter-key",
  };
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (!String(url).includes("openrouter.ai")) {
      throw new Error("Unexpected provider URL: " + String(url));
    }
    return new Response(JSON.stringify({ error: "temporary upstream outage" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const page = await worker.fetch(new Request("https://ceoai.dev/", {
      headers: { Origin: "https://ceoai.dev" },
    }), env);
    assert.equal(page.status, 200);
    const cookie = page.headers.get("Set-Cookie")?.split(";")[0];
    assert.ok(cookie);
    const sessionId = cookie.match(/^ceoai_session=([0-9a-f-]{36})$/i)?.[1];
    assert.ok(sessionId);

    const originalMemory = {
      summary: "Sažetak prethodnog razgovora",
      messages: [
        { role: "user", content: "Sačuvaj postojeću istoriju" },
        { role: "assistant", content: "Istorija ostaje nepromenjena ako zahtev ne uspe." },
      ],
      estimatedTokensSaved: 12,
      compressions: 1,
    };
    await kv.put(`memory:${sessionId}`, JSON.stringify(originalMemory));

    const response = await worker.fetch(new Request("https://ceoai.dev/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://ceoai.dev",
        Cookie: cookie,
        "CF-Connecting-IP": "198.51.100.22",
      },
      body: JSON.stringify({ prompt: "Ovaj neuspešan zahtev ne sme ući u istoriju" }),
    }), env);

    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /AI provajderi trenutno nisu dostupni/);
    assert.equal(calls.length, 1, "the configured provider should be attempted exactly once");
    assert.deepEqual(
      await kv.get(`memory:${sessionId}`, "json"),
      originalMemory,
      "stored summary, messages, counters, and prior history must remain unchanged",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
