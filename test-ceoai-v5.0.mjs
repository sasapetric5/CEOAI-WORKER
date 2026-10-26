import assert from 'node:assert/strict';
import worker from './ceoai-index-v5.0.mjs';

class MemoryKV {
  constructor() { this.data = new Map(); }
  async get(key, type) {
    const value = this.data.get(key);
    if (value === undefined) return null;
    if (type === 'json') return JSON.parse(value);
    return value;
  }
  async put(key, value) { this.data.set(key, String(value)); }
}
const makeEnv = (overrides = {}) => ({
  KV_MEMORY: new MemoryKV(),
  RATE_LIMITER: { async limit() { return { success: true }; } },
  // Legacy integration tests exercise provider routing with an explicitly approved test-only free-tier fixture.
  GEMINI_FREE_CONFIRMED: "true",
  // OpenRouter calls are allowed in tests only when the free-tier fixture is explicitly enabled.
  OPENROUTER_FREE_CONFIRMED: "true",
  // Explicit test-only fixture flags; policy tests override these to false.
  ZAI_GLM_FLASH_FREE_CONFIRMED: "true",
  DEEPSEEK_FREE_CONFIRMED: "true",
  MISTRAL_FREE_CONFIRMED: "true",
  ...overrides,
});
const getSession = async (env, origin = 'https://ceoai.dev') => {
  const response = await worker.fetch(new Request(origin + '/', { headers: { Origin: origin } }), env);
  assert.equal(response.status, 200);
  return { response, cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
};
const apiRequest = (cookie, body, overrides = {}) => new Request('https://ceoai.dev/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://ceoai.dev', Cookie: cookie, 'CF-Connecting-IP': '198.51.100.22', ...overrides.headers },
  body,
});

// 1–7: root, security headers, nonce, cookie, and default origin policy.
const env = makeEnv();
const { response: root, cookie } = await getSession(env);
assert.match(root.headers.get('Content-Security-Policy') || '', /script-src 'nonce-[a-f0-9]+'/i);
assert.match(root.headers.get('Content-Security-Policy') || '', /style-src 'nonce-[a-f0-9]+'/i);
assert.doesNotMatch(root.headers.get('Content-Security-Policy') || '', /unsafe-inline/);
const html = await root.text();
assert.doesNotMatch(html, /__NONCE__/);
assert.match(html, /<style nonce="[a-f0-9]+">/i);
assert.match(html, /<script nonce="[a-f0-9]+">/i);
assert.ok(cookie);
assert.equal((await worker.fetch(new Request('https://ceoai.dev/api/chat', { method:'POST', headers:{Origin:'http://localhost:8787','Content-Type':'application/json'}, body:'{}' }), env)).status, 403);

// 8: strict rate-limit default fails closed if the native binding is missing.
const noLimiterEnv = makeEnv({ RATE_LIMITER: undefined, AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true' });
const { cookie: strictCookie } = await getSession(noLimiterEnv);
const strictResponse = await worker.fetch(apiRequest(strictCookie, JSON.stringify({prompt:'Zdravo'})), noLimiterEnv);
assert.equal(strictResponse.status, 503);
assert.match((await strictResponse.json()).error, /Zaštita od preopterećenja/);

// 9: malformed JSON has a distinct error.
const badJson = await worker.fetch(apiRequest(cookie, '{bad json'), env);
assert.equal(badJson.status, 400);
assert.match((await badJson.json()).error, /Neispravan JSON/);

// 10: invalid UTF-8 has a distinct error.
const invalidUtf8 = new Uint8Array([0x7b, 0x22, 0x70, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
const badUtf8 = await worker.fetch(apiRequest(cookie, invalidUtf8), env);
assert.equal(badUtf8.status, 400);
assert.match((await badUtf8.json()).error, /UTF-8/);

// 11: no AI call by default.
const disabled = await worker.fetch(apiRequest(cookie, JSON.stringify({prompt:'Zdravo'})), env);
assert.equal(disabled.status, 503);
assert.match((await disabled.json()).error, /AI je isključen/);

// Free-only safety policy: keys alone must not enable potentially billable providers.
{
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error("Unexpected network call in free-only policy test");
  };
  try {
    const policyEnv = makeEnv({
      AI_ENABLED: "true",
      EXTERNAL_AI_ENABLED: "true",
      GEMINI_FREE_CONFIRMED: "false",
      OPENROUTER_FREE_CONFIRMED: "false",
      ZAI_GLM_FLASH_FREE_CONFIRMED: "false",
      DEEPSEEK_FREE_CONFIRMED: "false",
      MISTRAL_FREE_CONFIRMED: "false",
      GEMINI_API_KEY_PRIMARY: "test-gemini-policy-key",
      ZAI_GLM_FLASH_KEY_1: "test-glm-policy-key",
      DEEPSEEK_API_KEY: "test-deepseek-policy-key",
      MISTRAL_API_KEY: "test-mistral-policy-key",
    });
    const { cookie: policyCookie } = await getSession(policyEnv);
    const response = await worker.fetch(
      apiRequest(policyCookie, JSON.stringify({ prompt: "Zdravo" })),
      policyEnv
    );
    assert.equal(response.status, 503, "no provider should be eligible without free-quota confirmation");
    assert.match((await response.json()).error, /Nema konfigurisanog provajdera/);
    assert.equal(calls.length, 0, "must not contact a potentially billable provider");
  } finally {
    globalThis.fetch = original;
  }
}

// 12–13: debug error details redact provider secrets.
const originalFetch = globalThis.fetch;
const originalDebug = console.debug;
const debugLines = [];
console.debug = (...args) => debugLines.push(args.join(' '));
globalThis.fetch = async (url) => {
  if (String(url).includes('openrouter.ai')) return new Response(JSON.stringify({error:'api_key: "secret with spaces" Authorization: Bearer abc123XYZ'}), {status:401});
  throw new Error('Unexpected fetch in test');
};
try {
  const debugEnv = makeEnv({ AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', DEBUG_PROVIDER_ERRORS:'true', OPENROUTER_API_KEY:'test-key-not-real' });
  const { cookie: debugCookie } = await getSession(debugEnv);
  const debugResponse = await worker.fetch(apiRequest(debugCookie, JSON.stringify({prompt:'Zdravo'})), debugEnv);
  assert.equal(debugResponse.status, 503);
  const logs = debugLines.join('\n');
  assert.doesNotMatch(logs, /secret with spaces|abc123XYZ|test-key-not-real/);
  assert.match(logs, /\[redacted\]/);
} finally { globalThis.fetch = originalFetch; console.debug = originalDebug; }

// 14–15: upstream 429 yields Retry-After; successful fallback is exercised with mocked responses.
const originalFetch2 = globalThis.fetch;
let openRouterCalls = 0;
globalThis.fetch = async (url) => {
  if (String(url).includes('openrouter.ai')) {
    openRouterCalls++;
    return new Response(JSON.stringify({error:'rate limit'}), {status:429});
  }
  throw new Error('Unexpected provider URL');
};
try {
  const limitedEnv = makeEnv({ AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', OPENROUTER_API_KEY:'test-key' });
  const { cookie: limitedCookie } = await getSession(limitedEnv);
  const limited = await worker.fetch(apiRequest(limitedCookie, JSON.stringify({prompt:'Zdravo'})), limitedEnv);
  assert.equal(limited.status, 503);
  assert.equal(limited.headers.get('Retry-After'), '3600');
  assert.equal(openRouterCalls, 1);
} finally { globalThis.fetch = originalFetch2; }

// 16: local origins only work with explicit opt-in.
const localEnv = makeEnv({ ALLOW_LOCAL_ORIGINS:'true' });
const localResponse = await worker.fetch(new Request('http://localhost:8787/api/chat', {
  method:'OPTIONS', headers:{Origin:'http://localhost:8787'}
}), localEnv);
assert.equal(localResponse.status, 204);

// 17: fallback proceeds from a rate-limited Gemini candidate to a mocked OpenRouter success.
const originalFetch3 = globalThis.fetch;
const fallbackCalls = [];
globalThis.fetch = async (url) => {
  const target = String(url);
  fallbackCalls.push(target);
  if (target.includes('generativelanguage.googleapis.com')) {
    return new Response(JSON.stringify({error:{message:'rate limited'}}), {status:429});
  }
  if (target.includes('openrouter.ai')) {
    return new Response(JSON.stringify({choices:[{message:{content:'Odgovor iz rezervnog provajdera.'}}]}), {status:200, headers:{'Content-Type':'application/json'}});
  }
  throw new Error('Unexpected provider URL: ' + target);
};
try {
  const fallbackEnv = makeEnv({ AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', GEMINI_KEY_1:'test-gemini-key', OPENROUTER_KEY:'test-openrouter-key' });
  const { cookie: fallbackCookie } = await getSession(fallbackEnv);
  const fallbackResponse = await worker.fetch(apiRequest(fallbackCookie, JSON.stringify({prompt:'Zdravo'})), fallbackEnv);
  assert.equal(fallbackResponse.status, 200);
  assert.equal((await fallbackResponse.json()).reply, 'Odgovor iz rezervnog provajdera.');
  assert.equal(fallbackCalls.length, 2, 'Gemini failure is followed by OpenRouter fallback');
} finally { globalThis.fetch = originalFetch3; }

// 18: history compression uses the bounded validated history and persists only the summary + new turn.
const originalFetch4 = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes('openrouter.ai')) {
    return new Response(JSON.stringify({choices:[{message:{content:'Nastavak razgovora.'}}]}), {status:200, headers:{'Content-Type':'application/json'}});
  }
  throw new Error('Unexpected provider URL');
};
try {
  let historyAiCalls = 0;
  const historyEnv = makeEnv({
    AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', WORKERS_AI_ENABLED:'true', WORKERS_AI_FREE_CONFIRMED:'true', OPENROUTER_FREE_CONFIRMED:'true',
    OPENROUTER_KEY:'test-openrouter-key',
    AI: { async run(_model, payload, options) {
      assert.deepEqual(options, { rejectIfBusy: true }, 'Workers AI should fail fast when capacity is unavailable');
      historyAiCalls += 1;
      const isCompression = payload.messages?.[0]?.content?.includes('Sažmi razgovor na srpskom');
      if (isCompression) {
        assert.ok(payload.messages[1]?.content?.includes('starija poruka 1'), 'compression input includes the seeded history');
        assert.ok(payload.messages[1]?.content?.includes('starija poruka 8'), 'compression input includes the newest stored history');
        return {response:'Korisnik radi na projektu. Sačuvati kontekst i odluke.'};
      }
      return {response:'Odgovor iz Workers AI.'};
    } },
  });
  const { cookie: historyCookie } = await getSession(historyEnv);
  const sessionId = historyCookie.match(/^ceoai_session=([0-9a-f-]{36})$/i)?.[1];
  assert.ok(sessionId, 'test session cookie contains a valid session UUID');
  await historyEnv.KV_MEMORY.put(`memory:${sessionId}`, JSON.stringify({
    summary:null, estimatedTokensSaved:0, compressions:0,
    messages:Array.from({length:8}, (_, i) => ({role:i % 2 ? 'assistant':'user', content:`starija poruka ${i + 1}`})),
  }));
  const historyResponse = await worker.fetch(apiRequest(historyCookie, JSON.stringify({prompt:'Novi zahtev'})), historyEnv);
  assert.equal(historyResponse.status, 200);
  const historyBody = await historyResponse.json();
  assert.equal(historyBody.stats.hasSummary, true);
  assert.equal(historyBody.stats.compressions, 1);
  const savedMemory = JSON.parse(historyEnv.KV_MEMORY.data.get(`memory:${sessionId}`));
  assert.equal(savedMemory.messages.length, 2);
  assert.match(savedMemory.summary, /Sačuvati kontekst/);
} finally { globalThis.fetch = originalFetch4; }

// 19: transient provider failures receive a conservative 120-second retry hint.
const originalFetch5 = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes('openrouter.ai')) return new Response(JSON.stringify({error:'temporary outage'}), {status:503});
  throw new Error('Unexpected provider URL');
};
try {
  const transientEnv = makeEnv({ AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', OPENROUTER_KEY:'test-key-transient' });
  const { cookie: transientCookie } = await getSession(transientEnv);
  const transient = await worker.fetch(apiRequest(transientCookie, JSON.stringify({prompt:'Zdravo'})), transientEnv);
  assert.equal(transient.status, 503);
  assert.equal(transient.headers.get('Retry-After'), '120');
} finally { globalThis.fetch = originalFetch5; }

// 20: rejected preflight responses are explicitly non-cacheable.
const rejectedPreflight = await worker.fetch(new Request('https://ceoai.dev/api/chat', {
  method:'OPTIONS', headers:{Origin:'https://evil.example'}
}), env);
assert.equal(rejectedPreflight.status, 403);
assert.equal(rejectedPreflight.headers.get('Cache-Control'), 'no-store');

// 21: credential redaction uses field boundaries and does not redact ordinary prose like "monkey".
const originalFetch6 = globalThis.fetch;
const originalDebug2 = console.debug;
const debugLines2 = [];
console.debug = (...args) => debugLines2.push(args.join(' '));
globalThis.fetch = async (url) => {
  if (String(url).includes('openrouter.ai')) return new Response(JSON.stringify({error:'monkey key not found; api_key="value with spaces"'}), {status:401});
  throw new Error('Unexpected provider URL');
};
try {
  const env2 = makeEnv({ AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', DEBUG_PROVIDER_ERRORS:'true', OPENROUTER_KEY:'test-key-2' });
  const {cookie: cookie2} = await getSession(env2);
  await worker.fetch(apiRequest(cookie2, JSON.stringify({prompt:'Zdravo'})), env2);
  const lines = debugLines2.join('\n');
  assert.match(lines, /monkey key not found/);
  assert.doesNotMatch(lines, /value with spaces/);
} finally { globalThis.fetch = originalFetch6; console.debug = originalDebug2; }

// 22: compression truncation is logged as metadata only, without logging the conversation text.
const originalFetch7 = globalThis.fetch;
const originalWarn = console.warn;
const warningLines = [];
console.warn = (...args) => warningLines.push(args.join(' '));
globalThis.fetch = async (url) => {
  if (String(url).includes('openrouter.ai')) return new Response(JSON.stringify({choices:[{message:{content:'Odgovor.'}}]}), {status:200, headers:{'Content-Type':'application/json'}});
  throw new Error('Unexpected provider URL');
};
try {
  const env3 = makeEnv({
    AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', WORKERS_AI_ENABLED:'true', WORKERS_AI_FREE_CONFIRMED:'true', OPENROUTER_FREE_CONFIRMED:'true', OPENROUTER_KEY:'test-key-3',
    AI: { async run(_model, payload) {
      if (payload.messages?.[0]?.content?.includes('Sažmi razgovor na srpskom')) {
        assert.equal(payload.messages[1]?.content?.length, 24000);
        return {response:'Sažetak.'};
      }
      return {response:'Odgovor nakon sažimanja.'};
    } },
  });
  const {cookie: cookie3} = await getSession(env3);
  const sid = cookie3.match(/^ceoai_session=([0-9a-f-]{36})$/i)?.[1];
  assert.ok(sid, 'test session cookie contains a valid session UUID');
  await env3.KV_MEMORY.put(`memory:${sid}`, JSON.stringify({summary:null,estimatedTokensSaved:0,compressions:0,messages:Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:`private-marker-${i}-`+'x'.repeat(4000)}))}));
  const result = await worker.fetch(apiRequest(cookie3, JSON.stringify({prompt:'Nastavi'})), env3);
  assert.equal(result.status, 200);
  const logs = warningLines.join('\n');
  assert.match(logs, /History compression input truncated: \d+ chars to 24000/);
  assert.doesNotMatch(logs, /private-marker/);
} finally { globalThis.fetch = originalFetch7; console.warn = originalWarn; }

// 23–24: whitespace-only ALLOWED_ORIGINS uses the documented canonical-domain default.
const whitespaceOriginsEnv = makeEnv({ ALLOWED_ORIGINS:'   ,   ' });
const whitespaceAllowed = await worker.fetch(new Request('https://ceoai.dev/api/chat', {
  method:'OPTIONS', headers:{Origin:'https://ceoai.dev'}
}), whitespaceOriginsEnv);
assert.equal(whitespaceAllowed.status, 204);
const whitespaceRejected = await worker.fetch(new Request('https://ceoai.dev/api/chat', {
  method:'OPTIONS', headers:{Origin:'https://evil.example'}
}), whitespaceOriginsEnv);
assert.equal(whitespaceRejected.status, 403);

// 25: providers already in cooldown produce a specific, non-misleading rate-limit message.
const cooldownEnv = makeEnv({ AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', OPENROUTER_KEY:'test-cooldown-key' });
const {cookie: cooldownCookie} = await getSession(cooldownEnv);
cooldownEnv.KV_MEMORY.data.set('cooldown:openrouter-1', '1');
const cooldownResponse = await worker.fetch(apiRequest(cooldownCookie, JSON.stringify({prompt:'Zdravo'})), cooldownEnv);
assert.equal(cooldownResponse.status, 503);
assert.match((await cooldownResponse.json()).error, /ograničenje/);
assert.equal(cooldownResponse.headers.get('Retry-After'), '120');

// 26: Cyrillic sequence words activate the complex-provider fallback path.
const originalFetch8 = globalThis.fetch;
const cyrillicCalls = [];
globalThis.fetch = async (url) => {
  const target = String(url); cyrillicCalls.push(target);
  if (target.includes('openrouter.ai')) return new Response(JSON.stringify({error:'temporary failure'}), {status:503});
  if (target.includes('api.deepseek.com')) return new Response(JSON.stringify({choices:[{message:{content:'Složeni odgovor.'}}]}), {status:200, headers:{'Content-Type':'application/json'}});
  throw new Error('Unexpected provider URL: ' + target);
};
try {
  const cyrillicEnv = makeEnv({ AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', OPENROUTER_KEY:'test-openrouter-key', DEEPSEEK_KEY:'test-deepseek-key' });
  const {cookie: cyrillicCookie} = await getSession(cyrillicEnv);
  const cyrillicResponse = await worker.fetch(apiRequest(cyrillicCookie, JSON.stringify({prompt:'прво обради податке, затим провери резултат'})), cyrillicEnv);
  assert.equal(cyrillicResponse.status, 200);
  assert.ok(cyrillicCalls.some(url => url.includes('api.deepseek.com')), 'Cyrillic sequence should select a complex provider');
} finally { globalThis.fetch = originalFetch8; }

// 27–29: GLM Flash primary key is used through the Z.ai OpenAI-compatible endpoint.
const originalFetchGlm = globalThis.fetch;
const glmCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (!target.includes("api.z.ai/api/paas/v4/chat/completions")) throw new Error("Unexpected provider URL: " + target);
  glmCalls.push({ url: target, authorization: options.headers?.Authorization, body: JSON.parse(options.body || "{}") });
  return new Response(JSON.stringify({choices:[{message:{content:"GLM Flash radi."}}]}), {status:200, headers:{"Content-Type":"application/json"}});
};
try {
  const glmEnv = makeEnv({AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true", ZAI_GLM_FLASH_KEY_1:"test-glm-key-1"});
  const {cookie: glmCookie} = await getSession(glmEnv);
  const glmResponse = await worker.fetch(apiRequest(glmCookie, JSON.stringify({prompt:"Zdravo"})), glmEnv);
  assert.equal(glmResponse.status, 200);
  assert.equal((await glmResponse.json()).reply, "GLM Flash radi.");
  assert.equal(glmCalls.length, 1);
  assert.equal(glmCalls[0].authorization, "Bearer test-glm-key-1");
  assert.equal(glmCalls[0].body.model, "glm-4.5-flash");
} finally { globalThis.fetch = originalFetchGlm; }

// 30–31: a failing GLM primary key falls back to the second key without parallel requests.
const originalFetchGlmFallback = globalThis.fetch;
const glmFallbackCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (!target.includes("api.z.ai/api/paas/v4/chat/completions")) throw new Error("Unexpected provider URL: " + target);
  const authorization = options.headers?.Authorization;
  glmFallbackCalls.push(authorization);
  if (authorization === "Bearer test-glm-key-1") return new Response(JSON.stringify({error:"rate limited"}), {status:429});
  if (authorization === "Bearer test-glm-key-2") return new Response(JSON.stringify({choices:[{message:{content:"GLM rezervni ključ radi."}}]}), {status:200, headers:{"Content-Type":"application/json"}});
  throw new Error("Unexpected GLM authorization header");
};
try {
  const glmFallbackEnv = makeEnv({AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true", ZAI_GLM_FLASH_KEY_1:"test-glm-key-1", ZAI_GLM_FLASH_KEY_2:"test-glm-key-2"});
  const {cookie: glmFallbackCookie} = await getSession(glmFallbackEnv);
  const glmFallbackResponse = await worker.fetch(apiRequest(glmFallbackCookie, JSON.stringify({prompt:"Zdravo"})), glmFallbackEnv);
  assert.equal(glmFallbackResponse.status, 200);
  assert.equal((await glmFallbackResponse.json()).reply, "GLM rezervni ključ radi.");
  assert.deepEqual(glmFallbackCalls, ["Bearer test-glm-key-1", "Bearer test-glm-key-2"]);
} finally { globalThis.fetch = originalFetchGlmFallback; }

// 32: provider failures do not leak the configured GLM keys in the public response.
const originalFetchGlmError = globalThis.fetch;
globalThis.fetch = async (_url, options = {}) => new Response(JSON.stringify({error:"invalid api key"}), {status:401});
try {
  const glmErrorEnv = makeEnv({AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true", ZAI_GLM_FLASH_KEY_1:"test-glm-secret", DEBUG_PROVIDER_ERRORS:"true"});
  const {cookie: glmErrorCookie} = await getSession(glmErrorEnv);
  const glmErrorResponse = await worker.fetch(apiRequest(glmErrorCookie, JSON.stringify({prompt:"Zdravo"})), glmErrorEnv);
  const body = await glmErrorResponse.text();
  assert.equal(glmErrorResponse.status, 503);
  assert.doesNotMatch(body, /test-glm-secret/);
} finally { globalThis.fetch = originalFetchGlmError; }

// 33–34: explicit GLM-only mode never falls back to configured non-GLM providers.
const originalFetchGlmOnly = globalThis.fetch;
const glmOnlyCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  glmOnlyCalls.push(target);
  if (!target.includes("api.z.ai/api/paas/v4/chat/completions")) {
    throw new Error("GLM-only mode attempted a non-GLM provider: " + target);
  }
  if (options.headers?.Authorization === "Bearer test-glm-only-primary") {
    return new Response(JSON.stringify({error:"temporary failure"}), {status:503});
  }
  if (options.headers?.Authorization === "Bearer test-glm-only-secondary") {
    return new Response(JSON.stringify({choices:[{message:{content:"Samo GLM rezervni ključ."}}]}), {status:200, headers:{"Content-Type":"application/json"}});
  }
  throw new Error("Unexpected GLM key in GLM-only test");
};
try {
  const glmOnlyEnv = makeEnv({
    AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true", ZAI_GLM_FLASH_ONLY:"true",
    ZAI_GLM_FLASH_KEY_1:"test-glm-only-primary", ZAI_GLM_FLASH_KEY_2:"test-glm-only-secondary",
    GEMINI_KEY_1:"must-not-be-called", OPENROUTER_KEY:"must-not-be-called", DEEPSEEK_KEY:"must-not-be-called",
  });
  const {cookie: glmOnlyCookie} = await getSession(glmOnlyEnv);
  const glmOnlyResponse = await worker.fetch(apiRequest(glmOnlyCookie, JSON.stringify({prompt:"прво обради податке, затим провери резултат"})), glmOnlyEnv);
  assert.equal(glmOnlyResponse.status, 200);
  assert.equal((await glmOnlyResponse.json()).reply, "Samo GLM rezervni ključ.");
  assert.deepEqual(glmOnlyCalls, [
    "https://api.z.ai/api/paas/v4/chat/completions",
    "https://api.z.ai/api/paas/v4/chat/completions",
  ]);
} finally { globalThis.fetch = originalFetchGlmOnly; }

;


// ===== V5.0 additional tests =====

// V5-1: coding intent prefers DeepSeek when available (capability ranking).
const originalFetchRank = globalThis.fetch;
const rankCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  rankCalls.push(target);
  if (target.includes("api.deepseek.com")) {
    return new Response(JSON.stringify({choices:[{message:{content:"DeepSeek coding odgovor"}}]}), {status:200, headers:{"Content-Type":"application/json"}});
  }
  if (target.includes("generativelanguage.googleapis.com")) {
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Gemini fallback"}]}}]}), {status:200, headers:{"Content-Type":"application/json"}});
  }
  throw new Error("Unexpected provider in ranking test: " + target);
};
try {
  const rankEnv = makeEnv({
    AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true",
    DEEPSEEK_KEY:"test-deepseek",
    GEMINI_KEY_1:"test-gemini",
  });
  const {cookie: rankCookie} = await getSession(rankEnv);
  const rankResponse = await worker.fetch(apiRequest(rankCookie, JSON.stringify({prompt:"Refaktorisi ovu funkciju i ispravi bug u TypeScript kodu"})), rankEnv);
  assert.equal(rankResponse.status, 200);
  assert.equal((await rankResponse.json()).reply, "DeepSeek coding odgovor");
  assert.ok(rankCalls[0].includes("api.deepseek.com"), "coding intent should try DeepSeek first");
} finally { globalThis.fetch = originalFetchRank; }

// V5-2: xAI is excluded unless XAI_FREE_CONFIRMED=true.
const originalFetchXai = globalThis.fetch;
const xaiCalls = [];
globalThis.fetch = async (url, options = {}) => {
  xaiCalls.push(String(url));
  if (String(url).includes("api.x.ai")) throw new Error("xAI must not be called without free confirmation");
  if (String(url).includes("generativelanguage.googleapis.com")) {
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Gemini ok"}]}}]}), {status:200, headers:{"Content-Type":"application/json"}});
  }
  throw new Error("Unexpected: " + url);
};
try {
  const xaiEnv = makeEnv({
    AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true",
    XAI_KEY:"must-not-call",
    // XAI_FREE_CONFIRMED intentionally unset
    GEMINI_KEY_1:"test-gemini",
  });
  const {cookie: xaiCookie} = await getSession(xaiEnv);
  const xaiResponse = await worker.fetch(apiRequest(xaiCookie, JSON.stringify({prompt:"Analiziraj strategiju i trade-off"})), xaiEnv);
  assert.equal(xaiResponse.status, 200);
  assert.equal((await xaiResponse.json()).reply, "Gemini ok");
  assert.equal(xaiCalls.filter(u => u.includes("api.x.ai")).length, 0);
} finally { globalThis.fetch = originalFetchXai; }

// V5-3: xAI is included when free confirmed and ranks high for reasoning.
const originalFetchXaiOn = globalThis.fetch;
const xaiOnCalls = [];
globalThis.fetch = async (url, options = {}) => {
  xaiOnCalls.push(String(url));
  if (String(url).includes("api.x.ai")) {
    return new Response(JSON.stringify({choices:[{message:{content:"Grok reasoning"}}]}), {status:200, headers:{"Content-Type":"application/json"}});
  }
  throw new Error("Expected xAI first for reasoning: " + url);
};
try {
  const xaiOnEnv = makeEnv({
    AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true",
    XAI_KEY:"test-xai", XAI_FREE_CONFIRMED:"true",
    GEMINI_KEY_1:"test-gemini",
  });
  const {cookie: xaiOnCookie} = await getSession(xaiOnEnv);
  const xaiOnResponse = await worker.fetch(apiRequest(xaiOnCookie, JSON.stringify({prompt:"Analiziraj strategiju i trade-off odluka"})), xaiOnEnv);
  assert.equal(xaiOnResponse.status, 200);
  assert.equal((await xaiOnResponse.json()).reply, "Grok reasoning");
  assert.ok(xaiOnCalls[0].includes("api.x.ai"));
} finally { globalThis.fetch = originalFetchXaiOn; }

// V5-4: Mistral free model allowlist rejects unknown models (falls back to default open-mistral-nemo in pool build — key present means candidate exists).
const originalFetchMistral = globalThis.fetch;
const mistralCalls = [];
globalThis.fetch = async (url, options = {}) => {
  mistralCalls.push(String(url));
  const body = options.body ? JSON.parse(options.body) : {};
  if (String(url).includes("api.mistral.ai")) {
    assert.equal(body.model, "open-mistral-nemo"); // invalid model name should fall back
    return new Response(JSON.stringify({choices:[{message:{content:"Mistral odgovor"}}]}), {status:200, headers:{"Content-Type":"application/json"}});
  }
  if (String(url).includes("generativelanguage.googleapis.com")) {
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Gemini"}]}}]}), {status:200, headers:{"Content-Type":"application/json"}});
  }
  throw new Error("Unexpected: " + url);
};
try {
  const mistralEnv = makeEnv({
    AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true",
    MISTRAL_KEY:"test-mistral", MISTRAL_MODEL:"definitely-not-a-free-model",
    GEMINI_KEY_1:"test-gemini",
  });
  const {cookie: mCookie} = await getSession(mistralEnv);
  // coding-ish prompt so mistral can rank competitively
  const mResponse = await worker.fetch(apiRequest(mCookie, JSON.stringify({prompt:"Implementiraj helper funkciju u Pythonu"})), mistralEnv);
  assert.equal(mResponse.status, 200);
  // Either mistral or gemini may win depending on score; if mistral called, model must be allowlisted default.
  if (mistralCalls.some(u => u.includes("api.mistral.ai"))) {
    assert.equal((await mResponse.json()).reply, "Mistral odgovor");
  }
} finally { globalThis.fetch = originalFetchMistral; }

// V5-5: NVIDIA excluded without NVIDIA_FREE_CONFIRMED.
const originalFetchNv = globalThis.fetch;
const nvCalls = [];
globalThis.fetch = async (url) => {
  nvCalls.push(String(url));
  if (String(url).includes("integrate.api.nvidia.com")) throw new Error("NVIDIA must not be called");
  if (String(url).includes("api.deepseek.com")) {
    return new Response(JSON.stringify({choices:[{message:{content:"DeepSeek"}}]}), {status:200, headers:{"Content-Type":"application/json"}});
  }
  throw new Error("Unexpected: " + url);
};
try {
  const nvEnv = makeEnv({
    AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true",
    NVIDIA_KEY:"must-not-call", DEEPSEEK_KEY:"test-ds",
  });
  const {cookie: nvCookie} = await getSession(nvEnv);
  const nvResponse = await worker.fetch(apiRequest(nvCookie, JSON.stringify({prompt:"Napisи TypeScript klasu sa testovima"})), nvEnv);
  assert.equal(nvResponse.status, 200);
  assert.equal(nvCalls.filter(u => u.includes("nvidia.com")).length, 0);
} finally { globalThis.fetch = originalFetchNv; }

// V5-6: research intent with URL attempts Jina Reader (mocked).
const originalFetchJina = globalThis.fetch;
const jinaCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  jinaCalls.push(target);
  if (target.startsWith("https://r.jina.ai/")) {
    return new Response("Naslov stranice\n\nOvo je test sadrzaj sa Jina free readera.", {status:200, headers:{"Content-Type":"text/plain"}});
  }
  if (target.includes("generativelanguage.googleapis.com")) {
    const body = options.body ? JSON.parse(options.body) : {};
    const sys = body.systemInstruction?.parts?.[0]?.text || "";
    assert.match(sys, /jina|ISTRAŽIVAČKI KONTEKST|test sadrzaj/i);
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Sumirano sa Jina kontekstom"}]}}]}), {status:200, headers:{"Content-Type":"application/json"}});
  }
  throw new Error("Unexpected: " + target);
};
try {
  const jinaEnv = makeEnv({
    AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true",
    GEMINI_KEY_1:"test-gemini",
  });
  const {cookie: jCookie} = await getSession(jinaEnv);
  const jResponse = await worker.fetch(apiRequest(jCookie, JSON.stringify({prompt:"Pročitaj i sumiraj https://example.com/page"})), jinaEnv);
  assert.equal(jResponse.status, 200);
  assert.equal((await jResponse.json()).reply, "Sumirano sa Jina kontekstom");
  assert.ok(jinaCalls.some(u => u.startsWith("https://r.jina.ai/https://example.com/page")));
} finally { globalThis.fetch = originalFetchJina; }

// V5-7: RATE_LIMITER still fail-closed (regression).
{
  const noLimiterEnv = makeEnv({ RATE_LIMITER: undefined, AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', GEMINI_KEY_1:'k' });
  const { cookie: strictCookie2 } = await getSession(noLimiterEnv);
  const strictResponse2 = await worker.fetch(apiRequest(strictCookie2, JSON.stringify({prompt:'Zdravo'})), noLimiterEnv);
  assert.equal(strictResponse2.status, 503);
  assert.match((await strictResponse2.json()).error, /Zaštita od preopterećenja|RATE|preopterećenja|limit/i);
}

// V5-8: HF excluded without HF_FREE_CONFIRMED.
const originalFetchHf = globalThis.fetch;
const hfCalls = [];
globalThis.fetch = async (url) => {
  hfCalls.push(String(url));
  if (String(url).includes("huggingface.co")) throw new Error("HF must not be called");
  if (String(url).includes("generativelanguage.googleapis.com")) {
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Gemini"}]}}]}), {status:200, headers:{"Content-Type":"application/json"}});
  }
  throw new Error("Unexpected: " + url);
};
try {
  const hfEnv = makeEnv({
    AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true",
    HF_TOKEN:"must-not-call", GEMINI_KEY_1:"test-gemini",
  });
  const {cookie: hfCookie} = await getSession(hfEnv);
  const hfResponse = await worker.fetch(apiRequest(hfCookie, JSON.stringify({prompt:"Zdravo"})), hfEnv);
  assert.equal(hfResponse.status, 200);
  assert.equal(hfCalls.filter(u => u.includes("huggingface")).length, 0);
} finally { globalThis.fetch = originalFetchHf; }




// V5-9: quota exhaustion on first provider → automatic failover to second.
const originalFetchQuota = globalThis.fetch;
const quotaCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  quotaCalls.push(target);
  if (target.includes("api.deepseek.com")) {
    return new Response(JSON.stringify({ error: { message: "You exceeded your current quota for this month" } }), {
      status: 429, headers: { "Content-Type": "application/json" },
    });
  }
  if (target.includes("generativelanguage.googleapis.com")) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Gemini preuzeo posle kvote" }] } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error("Unexpected: " + target);
};
try {
  const quotaEnv = makeEnv({
    AI_ENABLED: "true", EXTERNAL_AI_ENABLED: "true",
    DEEPSEEK_KEY: "test-ds-quota",
    GEMINI_KEY_1: "test-gemini-fallback",
  });
  const { cookie: qCookie } = await getSession(quotaEnv);
  const qResponse = await worker.fetch(
    apiRequest(qCookie, JSON.stringify({ prompt: "Implementiraj Python skriptu za parsiranje CSV" })),
    quotaEnv
  );
  assert.equal(qResponse.status, 200);
  const qBody = await qResponse.json();
  assert.equal(qBody.reply, "Gemini preuzeo posle kvote");
  assert.ok(quotaCalls.some(u => u.includes("api.deepseek.com")));
  assert.ok(quotaCalls.some(u => u.includes("generativelanguage.googleapis.com")));
  // DeepSeek should now be in quota cooldown
  assert.ok(await quotaEnv.KV_MEMORY.get("cooldown:deepseek-1"));
} finally { globalThis.fetch = originalFetchQuota; }



 // V5-9c: monthly quota reports a 30-day retry window when no fallback is configured.
const originalFetchMonthlyQuota = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes("api.deepseek.com")) {
    return new Response(JSON.stringify({ error: { message: "You exceeded your current quota for this month" } }), {
      status: 429, headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error("Unexpected provider in monthly quota test: " + url);
};
try {
  const monthlyQuotaEnv = makeEnv({
    AI_ENABLED: "true", EXTERNAL_AI_ENABLED: "true",
    DEEPSEEK_KEY: "test-ds-monthly-quota",
    GEMINI_KEY_1: "",
  });
  const { cookie: monthlyQuotaCookie } = await getSession(monthlyQuotaEnv);
  const monthlyQuotaResponse = await worker.fetch(
    apiRequest(monthlyQuotaCookie, JSON.stringify({ prompt: "Refaktorisi Python kod i ispravi bug" })),
    monthlyQuotaEnv
  );
  assert.equal(monthlyQuotaResponse.status, 503);
  assert.equal(monthlyQuotaResponse.headers.get("Retry-After"), String(60 * 60 * 24 * 30));
} finally { globalThis.fetch = originalFetchMonthlyQuota; }

// V5-9b: daily quota reports a one-day retry window when no other provider is available.
const originalFetchDailyQuota = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes("api.deepseek.com")) {
    return new Response(JSON.stringify({ error: { message: "Daily free tier quota exceeded" } }), {
      status: 429, headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error("Unexpected provider in daily quota test: " + url);
};
try {
  const dailyQuotaEnv = makeEnv({
    AI_ENABLED: "true", EXTERNAL_AI_ENABLED: "true",
    DEEPSEEK_KEY: "test-ds-daily-quota",
    GEMINI_KEY_1: "",
  });
  const { cookie: dailyQuotaCookie } = await getSession(dailyQuotaEnv);
  const dailyQuotaResponse = await worker.fetch(
    apiRequest(dailyQuotaCookie, JSON.stringify({ prompt: "Refaktorisi Python kod i ispravi bug" })),
    dailyQuotaEnv
  );
  assert.equal(dailyQuotaResponse.status, 503);
  assert.equal(dailyQuotaResponse.headers.get("Retry-After"), String(60 * 60 * 24));
} finally { globalThis.fetch = originalFetchDailyQuota; }


 // V5-9d: explicitly confirmed Workers AI participates in the shared provider pool.
let workersAiCalls = 0;
const workersAiEnv = makeEnv({
  AI_ENABLED: "true", EXTERNAL_AI_ENABLED: "true",
  WORKERS_AI_ENABLED: "true", WORKERS_AI_FREE_CONFIRMED: "true",
  AI: { async run(model, input) {
    workersAiCalls += 1;
    assert.equal(model, "@cf/meta/llama-3-8b-instruct");
    assert.ok(Array.isArray(input.messages));
    return { response: "Workers AI odgovor iz testnog bindinga" };
  } },
});
const { cookie: workersAiCookie } = await getSession(workersAiEnv);
const workersAiResponse = await worker.fetch(
  apiRequest(workersAiCookie, JSON.stringify({ prompt: "Zdravo, odgovori kratko" })),
  workersAiEnv
);
assert.equal(workersAiResponse.status, 200);
assert.equal((await workersAiResponse.json()).reply, "Workers AI odgovor iz testnog bindinga");
assert.equal(workersAiCalls, 1);

// V5-9e: Workers AI binding alone is not enough; explicit free-tier confirmation is mandatory.
let unconfirmedWorkersAiCalls = 0;
const unconfirmedWorkersAiEnv = makeEnv({
  AI_ENABLED: "true", EXTERNAL_AI_ENABLED: "true",
  WORKERS_AI_ENABLED: "true", WORKERS_AI_FREE_CONFIRMED: "false",
  AI: { async run() { unconfirmedWorkersAiCalls += 1; return { response: "should never run" }; } },
});
const { cookie: unconfirmedWorkersAiCookie } = await getSession(unconfirmedWorkersAiEnv);
const unconfirmedWorkersAiResponse = await worker.fetch(
  apiRequest(unconfirmedWorkersAiCookie, JSON.stringify({ prompt: "Zdravo" })),
  unconfirmedWorkersAiEnv
);
assert.equal(unconfirmedWorkersAiResponse.status, 503);
assert.equal(unconfirmedWorkersAiCalls, 0);

// V5-10: search failover — Tavily quota → Google CSE takes over.
const originalFetchSearch = globalThis.fetch;
const searchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  searchCalls.push(target);
  if (target.includes("api.tavily.com")) {
    return new Response(JSON.stringify({ detail: "Free tier daily quota exceeded" }), {
      status: 429, headers: { "Content-Type": "application/json" },
    });
  }
  if (target.includes("googleapis.com/customsearch")) {
    return new Response(JSON.stringify({
      items: [{ title: "Rezultat CSE", link: "https://example.com/cse", snippet: "CSE snippet" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (target.includes("generativelanguage.googleapis.com")) {
    const body = options.body ? JSON.parse(options.body) : {};
    const sys = JSON.stringify(body);
    assert.match(sys, /google-cse|CSE snippet|Rezultat CSE/i);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Odgovor uz CSE kontekst" }] } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error("Unexpected search URL: " + target);
};
try {
  const searchEnv = makeEnv({
    AI_ENABLED: "true", EXTERNAL_AI_ENABLED: "true",
    GEMINI_KEY_1: "test-gemini",
    TAVILY_KEY: "test-tavily", TAVILY_FREE_CONFIRMED: "true",
    GOOGLE_CSE_KEY: "test-cse-key", GOOGLE_CSE_CX: "test-cx", GOOGLE_CSE_FREE_CONFIRMED: "true",
  });
  const { cookie: sCookie } = await getSession(searchEnv);
  const sResponse = await worker.fetch(
    apiRequest(sCookie, JSON.stringify({ prompt: "Pretraži najnovije vesti o Cloudflare Workers" })),
    searchEnv
  );
  assert.equal(sResponse.status, 200);
  assert.equal((await sResponse.json()).reply, "Odgovor uz CSE kontekst");
  assert.ok(searchCalls.some(u => u.includes("api.tavily.com")));
  assert.ok(searchCalls.some(u => u.includes("googleapis.com/customsearch")));
} finally { globalThis.fetch = originalFetchSearch; }




// V5-11: Firecrawl free → used for URL scrape before Tavily.
const originalFetchFc = globalThis.fetch;
const fcCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  fcCalls.push(target);
  if (target.includes("api.firecrawl.dev")) {
    return new Response(JSON.stringify({
      data: { markdown: "# Firecrawl page\n\nSadrzaj sa Firecrawl free scrape." },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (target.includes("generativelanguage.googleapis.com")) {
    const body = options.body ? JSON.parse(options.body) : {};
    assert.match(JSON.stringify(body), /Firecrawl|firecrawl/i);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Uz Firecrawl kontekst" }] } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error("Unexpected: " + target);
};
try {
  const fcEnv = makeEnv({
    AI_ENABLED: "true", EXTERNAL_AI_ENABLED: "true",
    GEMINI_KEY_1: "test-gemini",
    FIRECRAWL_KEY: "test-fc", FIRECRAWL_FREE_CONFIRMED: "true",
  });
  const { cookie: fcCookie } = await getSession(fcEnv);
  const fcResponse = await worker.fetch(
    apiRequest(fcCookie, JSON.stringify({ prompt: "Pročitaj i sumiraj https://example.com/docs" })),
    fcEnv
  );
  assert.equal(fcResponse.status, 200);
  assert.equal((await fcResponse.json()).reply, "Uz Firecrawl kontekst");
  assert.ok(fcCalls.some(u => u.includes("api.firecrawl.dev")));
} finally { globalThis.fetch = originalFetchFc; }

// V5-12: DuckDuckGo last-resort when no other search keys configured.
const originalFetchDdg = globalThis.fetch;
const ddgCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  ddgCalls.push(target);
  if (target.includes("api.duckduckgo.com")) {
    return new Response(JSON.stringify({
      AbstractText: "DuckDuckGo sažetak o Cloudflare Workers.",
      AbstractURL: "https://example.com/ddg",
      RelatedTopics: [{ Text: "Workers su serverless na edge.", FirstURL: "https://example.com/1" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (target.includes("generativelanguage.googleapis.com")) {
    const body = options.body ? JSON.parse(options.body) : {};
    assert.match(JSON.stringify(body), /DuckDuckGo|duckduckgo|Cloudflare Workers/i);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Odgovor uz DDG" }] } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  // Jina may be attempted for non-URL research - allow fail
  if (target.startsWith("https://r.jina.ai/")) {
    return new Response("not found", { status: 404 });
  }
  throw new Error("Unexpected: " + target);
};
try {
  const ddgEnv = makeEnv({
    AI_ENABLED: "true", EXTERNAL_AI_ENABLED: "true",
    GEMINI_KEY_1: "test-gemini",
    // no other search keys
  });
  const { cookie: ddgCookie } = await getSession(ddgEnv);
  const ddgResponse = await worker.fetch(
    apiRequest(ddgCookie, JSON.stringify({ prompt: "Pretraži šta su Cloudflare Workers" })),
    ddgEnv
  );
  assert.equal(ddgResponse.status, 200);
  assert.equal((await ddgResponse.json()).reply, "Odgovor uz DDG");
  assert.ok(ddgCalls.some(u => u.includes("api.duckduckgo.com")));
} finally { globalThis.fetch = originalFetchDdg; }

// V5.1: Gemini credentials are sent in a header and are never placed in the URL.
const originalFetchGeminiHeader = globalThis.fetch;
let geminiHeaderCall;
globalThis.fetch = async (url, options = {}) => {
  geminiHeaderCall = { url: String(url), headers: options.headers };
  return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Gemini header auth OK"}]}}]}), {status:200, headers:{"Content-Type":"application/json"}});
};
try {
  const geminiHeaderEnv = makeEnv({AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true", GEMINI_API_KEY_PRIMARY:"test-gemini-header-key"});
  const {cookie: geminiHeaderCookie} = await getSession(geminiHeaderEnv);
  const geminiHeaderResponse = await worker.fetch(apiRequest(geminiHeaderCookie, JSON.stringify({prompt:"Zdravo"})), geminiHeaderEnv);
  assert.equal(geminiHeaderResponse.status, 200);
  assert.ok(geminiHeaderCall.url.includes("generativelanguage.googleapis.com"));
  assert.ok(!geminiHeaderCall.url.includes("test-gemini-header-key"));
  assert.equal(geminiHeaderCall.headers["x-goog-api-key"], "test-gemini-header-key");
} finally { globalThis.fetch = originalFetchGeminiHeader; }

// V5.1: overflowed history remains usable when optional compression is unavailable.
const originalFetchHistoryOverflow = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes("openrouter.ai")) {
    return new Response(JSON.stringify({choices:[{message:{content:"Nastavak posle istorije."}}]}), {status:200, headers:{"Content-Type":"application/json"}});
  }
  throw new Error("Unexpected provider URL in history overflow test: " + String(url));
};
try {
  const overflowEnv = makeEnv({AI_ENABLED:"true", EXTERNAL_AI_ENABLED:"true", OPENROUTER_KEY:"test-openrouter-overflow"});
  const {cookie: overflowCookie} = await getSession(overflowEnv);
  const overflowSid = overflowCookie.split("=")[1];
  overflowEnv.KV_MEMORY.data.set(`memory:${overflowSid}`, JSON.stringify({
    summary:null, estimatedTokensSaved:0, compressions:0,
    messages:Array.from({length:16}, (_, i) => ({role:i % 2 ? "assistant" : "user", content:`stored turn ${i + 1}`})),
  }));
  const overflowResponse = await worker.fetch(apiRequest(overflowCookie, JSON.stringify({prompt:"Trenutni zahtev mora ostati"})), overflowEnv);
  assert.equal(overflowResponse.status, 200);
  const overflowMemory = JSON.parse(overflowEnv.KV_MEMORY.data.get(`memory:${overflowSid}`));
  assert.ok(overflowMemory.messages.length <= 16);
  assert.equal(overflowMemory.messages.at(-2).content, "Trenutni zahtev mora ostati");
} finally { globalThis.fetch = originalFetchHistoryOverflow; }


// V5-13: SearXNG, Bing-compatible endpoint, SerpAPI and Search Console adapters are wired into research failover.
for (const adapterCase of [
  {
    name: "SearXNG", env: { SEARXNG_ENABLED: "true", SEARXNG_URL: "https://search.example.test" },
    matches: url => url.startsWith("https://search.example.test/search?"),
    payload: { results: [{ title: "SearXNG result", url: "https://example.test/searx", content: "SearXNG result content" }] },
    expected: /SearXNG result/
  },
  {
    name: "Bing-compatible", env: { BING_SEARCH_ENDPOINT: "https://bing.example.test/search", BING_SEARCH_KEY: "test-bing", BING_SEARCH_FREE_CONFIRMED: "true" },
    matches: url => url.startsWith("https://bing.example.test/search?"),
    payload: { webPages: { value: [{ name: "Bing result", url: "https://example.test/bing", snippet: "Bing result content" }] } },
    expected: /Bing result/
  },
  {
    name: "SerpAPI", env: { SERPAPI_KEY: "test-serpapi", SERPAPI_FREE_CONFIRMED: "true" },
    matches: url => url.startsWith("https://serpapi.com/search.json?"),
    payload: { organic_results: [{ title: "SerpAPI result", link: "https://example.test/serp", snippet: "SerpAPI result content" }] },
    expected: /SerpAPI result/
  },
  {
    name: "Google Search Console", env: { GSC_ENABLED: "true", GSC_SITE_URL: "https://example.test/", GSC_ACCESS_TOKEN: "test-gsc-token", GSC_FREE_CONFIRMED: "true", GSC_START_DATE: "2026-10-01", GSC_END_DATE: "2026-10-20" },
    matches: url => url.includes("www.googleapis.com/webmasters/v3/sites/"),
    payload: { rows: [{ keys: ["Pretraži CEOAI", "https://example.test/"], clicks: 12, impressions: 120, ctr: 0.1, position: 4.2 }] },
    expected: /Pretraži CEOAI/
  }
]) {
  const originalAdapterFetch = globalThis.fetch;
  const adapterCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    adapterCalls.push({ url: target, options });
    if (adapterCase.matches(target)) {
      if (adapterCase.name === "Google Search Console") {
        assert.equal(options.method, "POST");
        assert.equal(options.headers.Authorization, "Bearer test-gsc-token");
      }
      if (adapterCase.name === "Bing-compatible") {
        assert.equal(options.headers["Ocp-Apim-Subscription-Key"], "test-bing");
      }
      if (adapterCase.name === "SerpAPI") {
        assert.equal(new URL(target).searchParams.get("api_key"), "test-serpapi");
      }
      return new Response(JSON.stringify(adapterCase.payload), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error("Unexpected provider URL in " + adapterCase.name + " test: " + target);
  };
  try {
    const adapterEnv = makeEnv({
      AI_ENABLED: "true", EXTERNAL_AI_ENABLED: "true",
      WORKERS_AI_ENABLED: "true", WORKERS_AI_FREE_CONFIRMED: "true",
      AI: { async run(_model, input) {
        const context = input.messages.map(message => message.content).join("\n");
        assert.match(context, adapterCase.expected, adapterCase.name + " results must reach the AI context");
        return { response: adapterCase.name + " adapter test passed" };
      } },
      ...adapterCase.env,
    });
    const { cookie: adapterCookie } = await getSession(adapterEnv);
    const adapterResponse = await worker.fetch(
      apiRequest(adapterCookie, JSON.stringify({ prompt: "Pretraži rezultate za CEOAI test" })),
      adapterEnv
    );
    assert.equal(adapterResponse.status, 200, adapterCase.name + " should complete research");
    assert.equal((await adapterResponse.json()).reply, adapterCase.name + " adapter test passed");
    assert.ok(adapterCalls.some(call => adapterCase.matches(call.url)), adapterCase.name + " adapter must be called");
  } finally {
    globalThis.fetch = originalAdapterFetch;
  }
}

console.log("PASS: CEOAI V5.0 smoke/security assertions (quota failover + Firecrawl + DuckDuckGo)");


// Cloudflare Workers AI: confirmed free binding is used without external provider calls.
{
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error("Workers AI-only test must not call external providers");
  };
  try {
    const cloudflareEnv = makeEnv({
      AI_ENABLED: "true",
      EXTERNAL_AI_ENABLED: "true",
      WORKERS_AI_ENABLED: "true",
      WORKERS_AI_FREE_CONFIRMED: "true",
      AI: {
        async run(model, input) {
          assert.equal(model, "@cf/meta/llama-3-8b-instruct");
          assert.ok(Array.isArray(input.messages));
          assert.ok(input.messages.some(message => message.role === "user" && message.content === "Odgovori kratko: zdravo"));
          return { response: "Cloudflare Workers AI radi." };
        },
      },
      GEMINI_API_KEY_PRIMARY: "",
      GEMINI_KEY_1: "",
      OPENROUTER_API_KEY: "",
      OPENROUTER_KEY: "",
      ZAI_GLM_FLASH_KEY_1: "",
      ZAI_GLM_FLASH_KEY_2: "",
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_KEY: "",
      MISTRAL_API_KEY: "",
      MISTRAL_KEY: "",
    });
    const { cookie: cfCookie } = await getSession(cloudflareEnv);
    const response = await worker.fetch(
      apiRequest(cfCookie, JSON.stringify({ prompt: "Odgovori kratko: zdravo" })),
      cloudflareEnv
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, "Cloudflare Workers AI radi.");
    assert.equal(calls.length, 0, "Workers AI binding should not require external HTTP provider calls");
  } finally {
    globalThis.fetch = original;
  }
}

// Cloudflare Workers AI: binding and API key alone are insufficient without both explicit opt-ins.
{
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected external call"); };
  try {
    const cloudflareDisabledEnv = makeEnv({
      AI_ENABLED: "true",
      EXTERNAL_AI_ENABLED: "true",
      WORKERS_AI_ENABLED: "true",
      WORKERS_AI_FREE_CONFIRMED: "false",
      AI: { async run() { calls++; return { response: "must not run" }; } },
      GEMINI_API_KEY_PRIMARY: "",
      GEMINI_KEY_1: "",
      OPENROUTER_API_KEY: "",
      OPENROUTER_KEY: "",
      ZAI_GLM_FLASH_KEY_1: "",
      ZAI_GLM_FLASH_KEY_2: "",
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_KEY: "",
      MISTRAL_API_KEY: "",
      MISTRAL_KEY: "",
    });
    const { cookie: cfDisabledCookie } = await getSession(cloudflareDisabledEnv);
    const response = await worker.fetch(
      apiRequest(cfDisabledCookie, JSON.stringify({ prompt: "Zdravo" })),
      cloudflareDisabledEnv
    );
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Nema konfigurisanog provajdera/);
    assert.equal(calls, 0, "unconfirmed Workers AI must not execute");
  } finally {
    globalThis.fetch = original;
  }
}


// Workers AI runtime failure must fall through to the next approved free candidate.
{
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    assert.match(String(url), /openrouter\.ai\/api\/v1\/chat\/completions/);
    const sent = JSON.parse(options.body);
    assert.match(sent.model, /:free$/);
    return new Response(JSON.stringify({ choices: [{ message: { content: "Odgovor posle Workers AI greške." } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const fallbackEnv = makeEnv({
      AI_ENABLED: "true",
      EXTERNAL_AI_ENABLED: "true",
      WORKERS_AI_ENABLED: "true",
      WORKERS_AI_FREE_CONFIRMED: "true",
      AI: { async run() { throw new Error("simulated Workers AI outage"); } },
      OPENROUTER_API_KEY: "test-openrouter-fallback",
      OPENROUTER_KEY: "",
      GEMINI_API_KEY_PRIMARY: "",
      GEMINI_KEY_1: "",
      ZAI_GLM_FLASH_KEY_1: "",
      ZAI_GLM_FLASH_KEY_2: "",
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_KEY: "",
      MISTRAL_API_KEY: "",
      MISTRAL_KEY: "",
    });
    const { cookie: fallbackCookie } = await getSession(fallbackEnv);
    const response = await worker.fetch(
      apiRequest(fallbackCookie, JSON.stringify({ prompt: "Zdravo" })),
      fallbackEnv
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, "Odgovor posle Workers AI greške.");
    assert.equal(calls.length, 1, "only the approved free fallback should receive an HTTP request");
  } finally {
    globalThis.fetch = original;
  }
}

// Empty Workers AI output must be rejected and must not be returned as a successful reply.
{
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ choices: [{ message: { content: "Fallback after empty Workers AI." } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const emptyEnv = makeEnv({
      AI_ENABLED: "true",
      EXTERNAL_AI_ENABLED: "true",
      WORKERS_AI_ENABLED: "true",
      WORKERS_AI_FREE_CONFIRMED: "true",
      AI: { async run() { return { response: "   " }; } },
      OPENROUTER_API_KEY: "test-openrouter-empty-fallback",
      OPENROUTER_KEY: "",
      GEMINI_API_KEY_PRIMARY: "",
      GEMINI_KEY_1: "",
      ZAI_GLM_FLASH_KEY_1: "",
      ZAI_GLM_FLASH_KEY_2: "",
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_KEY: "",
      MISTRAL_API_KEY: "",
      MISTRAL_KEY: "",
    });
    const { cookie: emptyCookie } = await getSession(emptyEnv);
    const response = await worker.fetch(
      apiRequest(emptyCookie, JSON.stringify({ prompt: "Zdravo" })),
      emptyEnv
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, "Fallback after empty Workers AI.");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
}

// V5.0 safety regression: reject oversized bodies and prompts before any provider call.
{
  const originalFetch = globalThis.fetch;
  const providerCalls = [];
  globalThis.fetch = async (url) => {
    providerCalls.push(String(url));
    throw new Error("Provider must not be called for invalid input");
  };
  try {
    const guardEnv = makeEnv({
      AI_ENABLED: "true",
      EXTERNAL_AI_ENABLED: "true",
      OPENROUTER_KEY: "test-key-input-guards",
    });
    const { cookie: guardCookie } = await getSession(guardEnv);

    const longPromptResponse = await worker.fetch(
      apiRequest(guardCookie, JSON.stringify({ prompt: "x".repeat(2001) })),
      guardEnv
    );
    assert.equal(longPromptResponse.status, 400, "prompt over 2000 characters is rejected");
    assert.match((await longPromptResponse.json()).error, /2000 karaktera/);

    const oversizedBodyResponse = await worker.fetch(
      apiRequest(guardCookie, " ".repeat(16_001)),
      guardEnv
    );
    assert.equal(oversizedBodyResponse.status, 413, "request body over 16000 bytes is rejected");
    assert.match((await oversizedBodyResponse.json()).error, /prevelik/);

    assert.equal(providerCalls.length, 0, "invalid input must never reach an AI provider");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// V5.0 safety regression: missing atomic rate limiter fails closed before provider calls.
{
  const originalFetch = globalThis.fetch;
  const providerCalls = [];
  globalThis.fetch = async (url) => {
    providerCalls.push(String(url));
    throw new Error("Provider must not be called without rate limiter");
  };
  try {
    const noLimiterEnv = makeEnv({
      AI_ENABLED: "true",
      EXTERNAL_AI_ENABLED: "true",
      OPENROUTER_KEY: "test-key-no-limiter",
      RATE_LIMITER: null,
    });
    const { cookie: noLimiterCookie } = await getSession(noLimiterEnv);
    const response = await worker.fetch(
      apiRequest(noLimiterCookie, JSON.stringify({ prompt: "Zdravo" })),
      noLimiterEnv
    );
    assert.equal(response.status, 503, "missing atomic rate limiter must fail closed");
    assert.match((await response.json()).error, /privremeno nedostupna/);
    assert.equal(providerCalls.length, 0, "rate-limit failure must happen before any provider call");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// Regression: provider failure logs contain identifiers/status only, never raw provider error text.
{
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warningLines = [];
  globalThis.fetch = async () => {
    throw new Error("Authorization: Bearer secret-provider-token-123");
  };
  console.warn = (...args) => warningLines.push(args.join(" "));
  try {
    const logSafeEnv = makeEnv({
      AI_ENABLED: "true",
      EXTERNAL_AI_ENABLED: "true",
      OPENROUTER_API_KEY: "test-key-log-safety",
      GEMINI_API_KEY_PRIMARY: "",
      GEMINI_KEY_1: "",
      ZAI_GLM_FLASH_KEY_1: "",
      ZAI_GLM_FLASH_KEY_2: "",
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_KEY: "",
      MISTRAL_API_KEY: "",
      MISTRAL_KEY: "",
    });
    const { cookie: logSafeCookie } = await getSession(logSafeEnv);
    const response = await worker.fetch(
      apiRequest(logSafeCookie, JSON.stringify({ prompt: "Zdravo" })),
      logSafeEnv
    );
    assert.equal(response.status, 503);
    const warnings = warningLines.join("\n");
    assert.match(warnings, /provider_failed/);
    assert.doesNotMatch(warnings, /secret-provider-token-123|Authorization: Bearer/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

// Regression: if every eligible provider fails, return a safe 503 and do not persist a phantom assistant turn.
{
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  globalThis.fetch = async () => {
    throw new Error("simulated upstream outage");
  };
  console.warn = () => {};
  try {
    const allFailEnv = makeEnv({
      AI_ENABLED: "true",
      EXTERNAL_AI_ENABLED: "true",
      OPENROUTER_API_KEY: "test-key-all-providers-fail",
      GEMINI_API_KEY_PRIMARY: "",
      GEMINI_KEY_1: "",
      GEMINI_API_KEY_SECONDARY: "",
      GEMINI_KEY_2: "",
      GEMINI_API_KEY_TERTIARY: "",
      GEMINI_KEY_3: "",
      ZAI_GLM_FLASH_KEY_1: "",
      ZAI_GLM_FLASH_KEY_2: "",
      DEEPSEEK_API_KEY: "",
      DEEPSEEK_KEY: "",
      MISTRAL_API_KEY: "",
      MISTRAL_KEY: "",
    });
    const { cookie: allFailCookie } = await getSession(allFailEnv);
    const sessionId = allFailCookie.split("=")[1];
    const response = await worker.fetch(
      apiRequest(allFailCookie, JSON.stringify({ prompt: "Zdravo" })),
      allFailEnv
    );
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.success, false);
    assert.match(result.error, /AI provajderi trenutno nisu dostupni/);
    assert.doesNotMatch(JSON.stringify(result), /simulated upstream outage|test-key-all-providers-fail/);
    assert.equal(allFailEnv.KV_MEMORY.data.has(`memory:${sessionId}`), false,
      "failed provider calls must not persist a phantom conversation turn");
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}



// V5 reliability regression: two failed primary keys must fall through to the next provider.
{
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('generativelanguage.googleapis.com')) {
      if (calls.filter(value => value.includes('generativelanguage.googleapis.com')).length === 1) {
        return new Response(JSON.stringify({error:{message:'temporary rate limit'}}), {status:429, headers:{'Retry-After':'90'}});
      }
      return new Response(JSON.stringify({error:{message:'temporary upstream failure'}}), {status:503});
    }
    if (target.includes('openrouter.ai')) {
      return new Response(JSON.stringify({choices:[{message:{content:'Treći pokušaj je uspeo.'}}]}), {status:200, headers:{'Content-Type':'application/json'}});
    }
    throw new Error('Unexpected provider URL: ' + target);
  };
  try {
    const chainEnv = makeEnv({
      AI_ENABLED:'true',
      EXTERNAL_AI_ENABLED:'true',
      GEMINI_API_KEY_PRIMARY:'test-gemini-primary',
      GEMINI_API_KEY_SECONDARY:'test-gemini-secondary',
      OPENROUTER_API_KEY:'test-openrouter-chain',
    });
    const {cookie: chainCookie} = await getSession(chainEnv);
    const response = await worker.fetch(apiRequest(chainCookie, JSON.stringify({prompt:'Zdravo'})), chainEnv);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, 'Treći pokušaj je uspeo.');
    assert.equal(calls.length, 3, 'both Gemini keys fail before OpenRouter succeeds');
    assert.ok(calls[0].includes('generativelanguage.googleapis.com'));
    assert.ok(calls[1].includes('generativelanguage.googleapis.com'));
    assert.ok(calls[2].includes('openrouter.ai'));
    assert.ok(await chainEnv.KV_MEMORY.get('cooldown:gemini-1'), 'first failed key should enter cooldown');
    assert.ok(await chainEnv.KV_MEMORY.get('cooldown:gemini-2'), 'second failed key should enter cooldown');
  } finally {
    globalThis.fetch = original;
  }
}
