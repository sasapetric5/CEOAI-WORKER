import assert from 'node:assert/strict';
import worker from './ceoai-index-v4.9.mjs';

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
  const debugEnv = makeEnv({ AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', DEBUG_PROVIDER_ERRORS:'true', OPENROUTER_KEY:'test-key-not-real' });
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
  const limitedEnv = makeEnv({ AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', OPENROUTER_KEY:'test-key' });
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
  const historyEnv = makeEnv({
    AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', WORKERS_AI_ENABLED:'true',
    OPENROUTER_KEY:'test-openrouter-key',
    AI: { async run(_model, payload) {
      assert.ok(payload.messages[1].content.includes('starija poruka 1'));
      return {response:'Korisnik radi na projektu. Sačuvati kontekst i odluke.'};
    } },
  });
  const { cookie: historyCookie } = await getSession(historyEnv);
  const sessionId = historyCookie.split('=')[1];
  historyEnv.KV_MEMORY.data.set(`memory:${sessionId}`, JSON.stringify({
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
    AI_ENABLED:'true', EXTERNAL_AI_ENABLED:'true', WORKERS_AI_ENABLED:'true', OPENROUTER_KEY:'test-key-3',
    AI: { async run(_model, payload) { assert.equal(payload.messages[1].content.length, 24000); return {response:'Sažetak.'}; } },
  });
  const {cookie: cookie3} = await getSession(env3);
  const sid = cookie3.split('=')[1];
  env3.KV_MEMORY.data.set(`memory:${sid}`, JSON.stringify({summary:null,estimatedTokensSaved:0,compressions:0,messages:Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:`private-marker-${i}-`+'x'.repeat(4000)}))}));
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

console.log("PASS: 32 CEOAI V4.9 smoke/security assertions");