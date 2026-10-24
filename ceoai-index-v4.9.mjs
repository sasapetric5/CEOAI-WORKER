// CEOAI.dev — Worker V4.9 (final hardening, Cyrillic intent support, clearer cooldown diagnostics)
// Security-first reference implementation. No provider is called unless explicitly enabled.
// Required binding: KV_MEMORY (Cloudflare KV). Optional binding: AI (Workers AI).
// Required secrets when external AI is explicitly enabled: provider API keys.
// IMPORTANT: requests fail closed when RATE_LIMITER is missing unless REQUIRE_ATOMIC_RATE_LIMITER=false.
// The opt-in KV fallback is non-atomic under concurrency and is for controlled testing only. Optional fallback: set
// OPENROUTER_COMPLEX_MODEL to a verified OpenRouter model ending in :free. Debug provider detail
// logging is disabled by default and can be enabled with DEBUG_PROVIDER_ERRORS=true.

const SESSION_TTL = 60 * 60 * 24 * 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 20;
const COMPRESSION_THRESHOLD = 8;
const MAX_PROMPT_CHARS = 2000;
const MAX_REQUEST_BYTES = 16_000;
const MAX_SUMMARY_CHARS = 4000;
const MAX_HISTORY_MESSAGES = 16;
const MAX_HISTORY_INPUT_MESSAGES = 64;
const MAX_REPLY_CHARS = 12000;
const PROVIDER_TIMEOUT_MS = 25000;
const COOLDOWN_TTL = 3600;
const MODEL = "@cf/meta/llama-3-8b-instruct";
let warnedMissingRateLimiter = false;
let warnedOpenRouterModelWithoutKey = false;
let warnedInvalidOpenRouterModel = false;

const HTML_PAGE = `<!doctype html>
<html lang="sr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>CEOAI — Control Panel</title>
  <style nonce="__NONCE__">
    :root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0}
    *{box-sizing:border-box}body{max-width:760px;margin:0 auto;padding:18px}
    .memory-panel{margin-top:14px}
    .panel{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:16px;margin-bottom:14px}
    h1{font-size:1.35rem;margin:0 0 6px;color:#6ee7b7}h2{font-size:1rem;margin:0 0 10px;color:#93c5fd}
    .muted{color:#94a3b8;font-size:.85rem}.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .stat{background:#0f172a;padding:12px;border-radius:10px;text-align:center}.number{font-size:1.4rem;font-weight:700}
    #chatBox{height:48vh;min-height:260px;overflow:auto;display:flex;flex-direction:column;gap:10px}
    .msg{padding:12px;border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45}
    .user{background:#334155;margin-left:8%;text-align:left}.assistant{background:#475569;margin-right:8%}
    .status{background:#064e3b;color:#a7f3d0}.error{background:#7f1d1d;color:#fecaca}
    .compose{display:flex;gap:8px}input{min-width:0;flex:1;background:#0f172a;border:1px solid #475569;border-radius:10px;padding:13px;color:white;font:inherit}
    button{border:0;border-radius:10px;padding:12px 16px;background:#059669;color:white;font-weight:700;font:inherit;cursor:pointer}
    button:disabled{opacity:.55;cursor:wait}button:focus-visible,input:focus-visible{outline:2px solid #6ee7b7;outline-offset:2px}
    #memoryDisplay{overflow-wrap:anywhere;white-space:pre-wrap}.foot{font-size:.75rem;color:#94a3b8;margin-top:8px}
    @media(max-width:480px){body{padding:10px}.compose{flex-direction:column}button{width:100%}}
  </style>
</head>
<body>
  <section class="panel">
    <h1>CEOAI — Control Panel</h1>
    <p class="muted">Lokalni interfejs · kontrolisana memorija · bez automatskih spoljnih radnji</p>
  </section>
  <section class="panel" aria-label="Statistika memorije">
    <h2>📊 Pregled memorije</h2>
    <div class="stats">
      <div class="stat"><div class="muted">Procenjena ušteda tokena*</div><div class="number" id="tokensSaved">0</div></div>
      <div class="stat"><div class="muted">Kompresije</div><div class="number" id="compressions">0</div></div>
    </div>
    <p class="foot">*Gruba procena, ne merenje stvarno potrošenih tokena.</p>
  </section>
  <section id="chatBox" class="panel" aria-live="polite" aria-label="Razgovor">
    <div class="msg assistant">Započnite razgovor. Istorija se čuva u serverskoj KV memoriji ove sesije.</div>
  </section>
  <form id="chatForm" class="compose">
    <input id="userInput" maxlength="2000" autocomplete="off" placeholder="Napišite poruku…" aria-label="Vaša poruka" required>
    <button id="sendButton" type="submit">Pošalji</button>
  </form>
  <section class="panel memory-panel">
    <h2>🧠 Status memorije</h2>
    <div id="memoryDisplay" role="status" class="muted">Sesija je spremna.</div>
  </section>
  <script nonce="__NONCE__">
    const form = document.getElementById('chatForm');
    const input = document.getElementById('userInput');
    const button = document.getElementById('sendButton');
    const chatBox = document.getElementById('chatBox');
    let busy = false;

    function addMessage(role, text) {
      const node = document.createElement('div');
      node.className = 'msg ' + (role === 'user' ? 'user' : 'assistant');
      // Never render model output as HTML.
      node.textContent = String(text ?? '');
      chatBox.appendChild(node);
      chatBox.scrollTop = chatBox.scrollHeight;
      return node;
    }

    function showStats(stats) {
      document.getElementById('tokensSaved').textContent = String(stats.estimatedTokensSaved ?? 0);
      document.getElementById('compressions').textContent = String(stats.compressions ?? 0);
      document.getElementById('memoryDisplay').textContent = stats.hasSummary
        ? 'Sažetak je aktivan. ' + stats.msgs + ' poruka u tekućem ciklusu.'
        : 'Prikupljanje konteksta: još ' + Math.max(0, stats.messagesLeft ?? 0) + ' poruka do kompresije.';
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const prompt = input.value.trim();
      if (!prompt) return;
      if (prompt.length > 2000) {
        addMessage('assistant', 'Poruka je predugačka (maksimum 2000 karaktera).');
        return;
      }

      busy = true;
      button.disabled = true;
      input.disabled = true;
      addMessage('user', prompt);
      input.value = '';
      const loading = addMessage('assistant', 'CEOAI obrađuje zahtev…');
      loading.classList.add('status');

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        let response;
        try {
          response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
            credentials: 'same-origin',
            signal: controller.signal
          });
        } finally {
          clearTimeout(timer);
        }

        let data;
        const contentType = response.headers.get('content-type') || '';
        try {
          if (!contentType.toLowerCase().includes('application/json')) throw new Error('non-json');
          data = await response.json();
        } catch {
          throw new Error('Server je vratio ne-JSON odgovor (HTTP ' + response.status + '). Pokušajte ponovo.');
        }

        loading.remove();
        if (response.ok && data.success) {
          addMessage('assistant', data.reply);
          showStats(data.stats || {});
        } else {
          const err = addMessage('assistant', data.error || 'Zahtev nije uspeo.');
          err.classList.add('error');
          if (response.status === 401) {
            document.getElementById('memoryDisplay').textContent = 'Sesija je istekla. Osvežite stranicu.';
          }
        }
      } catch (error) {
        loading.remove();
        const message = error?.name === 'AbortError'
          ? 'Zahtev je istekao. Možete pokušati ponovo.'
          : (error?.message || 'Mrežna greška. Proverite vezu.');
        addMessage('assistant', message).classList.add('error');
      } finally {
        busy = false;
        button.disabled = false;
        input.disabled = false;
        input.focus();
      }
    });
  </script>
</body>
</html>`;

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders },
  });
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Session IDs are intentionally restricted to UUID v4, matching crypto.randomUUID().
function validUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function estimateTokens(text) {
  // Heuristic only: non-ASCII Serbian/Cyrillic characters often tokenize less compactly.
  // This is not a provider tokenizer and must never be presented as an exact count.
  const value = String(text || "");
  let ascii = 0;
  let nonAscii = 0;
  for (const character of value) {
    if (character.codePointAt(0) <= 0x7f) ascii++;
    else nonAscii++;
  }
  return Math.ceil(ascii / 4 + nonAscii / 2);
}

function allowedOrigins(env) {
  // Production defaults to the canonical domain only. Local origins require explicit opt-in.
  const configured = typeof env.ALLOWED_ORIGINS === "string"
    ? env.ALLOWED_ORIGINS.split(",").map(value => value.trim()).filter(Boolean)
    : [];
  const origins = new Set(configured.length ? configured : ["https://ceoai.dev"]);
  if (env.ALLOW_LOCAL_ORIGINS === "true") {
    origins.add("http://localhost:8787");
    origins.add("http://127.0.0.1:8787");
  }
  return origins;
}

function isAllowedOrigin(origin, origins) {
  return origins.has(origin);
}

function validOpenRouterFreeModel(value) {
  if (typeof value !== "string") return false;
  const model = value.trim();
  // OpenRouter model IDs use a conservative allowlist; cap configuration input at 200 chars.
  return model.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*:free$/.test(model);
}

function chooseIntent(prompt) {
  const p = String(prompt || "").toLowerCase();
  // Length alone is not a reliable signal of complexity. Use task indicators instead.
  const strongSignals = /\b(refaktor|debug|otkloni|ispravi|implementir|arhitekt|bezbednos|security|testir|optimiz|uporedi|analizir|strategij|planiraj|kod|programir|repozitorij|worker|api)\w*\b/i;
  const multiStepSignals = /\b(korak|faza|prvo|zatim|testovi|testiraj|integracij|migracij|deploy|produkcij)\w*\b|(?<![\p{L}])(?:прво|друго|треће|затим|након|потом|коначно)(?![\p{L}])/iu;
  const hasCode = /```|\b(function|const|let|class|import|export|async|await)\b/.test(p);
  // The Serbian conjunction "i" is too common to be a complexity signal. Require
  // at least two distinct explicit sequencing signals instead of repeated words.
  const sequenceWords = p.match(/(?:\b(zatim|nakon|potom|takođe|takodje|prvo|drugo|treće|trece|konačno|konacno)\b|(?<![\p{L}])(?:прво|друго|треће|затим|након|потом|коначно)(?![\p{L}]))/gu) || [];
  const hasMultiStep = new Set(sequenceWords).size >= 2;
  return (strongSignals.test(p) || hasCode || (multiStepSignals.test(p) && hasMultiStep))
    ? "complex" : "fast";
}

async function withTimeoutFetch(url, options, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("Provider timeout"), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readProviderError(response, provider) {
  // Bound the amount of error text retained in memory/logs; never return it to the client.
  let detail = "";
  try { detail = (await response.text()).slice(0, 1200); } catch {}
  const error = new Error(`${provider} HTTP ${response.status}`);
  error.status = response.status;
  error.retryable = response.status === 429 || response.status >= 500;
  error.providerDetail = detail
    // Redact bearer credentials first, including when the text is JSON-escaped.
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/ig, "Bearer [redacted]")
    // Match credential field names at word boundaries; do not match substrings such as "monkey".
    // Supports quoted values with spaces and ordinary unquoted values.
    .replace(/\b(x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|token|key)\b\s*[:=]\s*(?:\\?["'][^"']*\\?["']|[^\s,;]+)/ig, "$1=[redacted]");
  return error;
}

async function executeModel(provider, messages) {
  let response;
  if (provider.provider === "gemini") {
    const systemText = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
    const turns = messages.filter(m => m.role !== "system");
    const contents = [];
    for (const m of turns) {
      const role = m.role === "assistant" ? "model" : "user";
      const previous = contents[contents.length - 1];
      if (previous && previous.role === role) previous.parts[0].text += "\n\n" + m.content;
      else contents.push({ role, parts: [{ text: m.content }] });
    }
    if (!contents.length || contents[contents.length - 1].role !== "user") {
      throw new Error("Gemini zahtev nema završnu korisničku poruku");
    }
    const payload = { contents };
    if (systemText) payload.systemInstruction = { parts: [{ text: systemText }] };
    response = await withTimeoutFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(provider.key)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    if (!response.ok) throw await readProviderError(response, "Gemini");
    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    const result = Array.isArray(parts) ? parts.map(p => p?.text || "").join("") : "";
    if (!result.trim()) throw new Error("Gemini je vratio prazan odgovor");
    return result.slice(0, MAX_REPLY_CHARS);
  }

  if (provider.provider === "glm-flash" || provider.provider === "openrouter" || provider.provider === "deepseek") {
    const isOpenRouter = provider.provider === "openrouter";
    const isDeepSeek = provider.provider === "deepseek";
    const endpoint = provider.provider === "glm-flash"
      ? "https://api.z.ai/api/paas/v4/chat/completions"
      : isOpenRouter
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.deepseek.com/chat/completions";
    const headers = { "Authorization": `Bearer ${provider.key}`, "Content-Type": "application/json" };
    if (isOpenRouter) {
      headers["HTTP-Referer"] = "https://ceoai.dev";
      headers["X-Title"] = "CEOAI";
    }
    response = await withTimeoutFetch(endpoint, {
      method: "POST", headers,
      body: JSON.stringify({
        model: provider.model,
        messages,
        max_tokens: 1800,
        temperature: 0.3,
      }),
    });
    if (!response.ok) throw await readProviderError(response, provider.provider);
    const data = await response.json();
    const result = data?.choices?.[0]?.message?.content;
    if (typeof result !== "string" || !result.trim()) throw new Error(`${provider.provider} je vratio prazan odgovor`);
    return result.slice(0, MAX_REPLY_CHARS);
  }
  throw new Error("Nepoznat AI provajder");
}

async function enforceRateLimit(env, ip, now) {
  // If the native limiter is configured, treat it as authoritative and avoid duplicate KV work.
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function") {
    const result = await env.RATE_LIMITER.limit({ key: ip });
    return Boolean(result?.success);
  }

  // Secure default: fail closed without the native limiter. The non-atomic KV fallback
  // is available only when an operator explicitly opts into it for a non-production test.
  if (env.REQUIRE_ATOMIC_RATE_LIMITER !== "false") {
    throw new Error("RATE_LIMITER_BINDING_REQUIRED");
  }
  if (!warnedMissingRateLimiter) {
    console.warn("RATE_LIMITER binding missing; using non-atomic KV fallback");
    warnedMissingRateLimiter = true;
  }

  // Explicitly opted-in best-effort fallback only: KV read/modify/write is not atomic under concurrency.
  const rateKey = `rate:${ip}`;
  let timestamps;
  try {
    const raw = await env.KV_MEMORY.get(rateKey);
    timestamps = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(timestamps)) timestamps = [];
  } catch {
    throw new Error("RATE_LIMIT_STORAGE_UNAVAILABLE");
  }
  timestamps = timestamps.filter(t => Number.isFinite(t) && now - t >= 0 && now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) return false;
  timestamps.push(now);
  try {
    await env.KV_MEMORY.put(rateKey, JSON.stringify(timestamps), { expirationTtl: 3600 });
  } catch {
    throw new Error("RATE_LIMIT_STORAGE_UNAVAILABLE");
  }
  return true;
}

async function readBodyLimited(request, maxBytes) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel("Request body too large"); } catch {}
        const error = new Error("REQUEST_BODY_TOO_LARGE");
        error.status = 413;
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("INVALID_UTF8");
  }
}

async function compressHistory(env, oldSummary, oldMessages) {
  // Defense in depth: compression must obey the same explicit AI opt-in contract.
  if (env.AI_ENABLED !== "true" || env.EXTERNAL_AI_ENABLED !== "true" ||
      !env.AI || env.WORKERS_AI_ENABLED !== "true") return null;
  const unboundedSource = [
    oldSummary ? `PRETHODNI SAŽETAK:\n${oldSummary}` : "",
    ...oldMessages.map(m => `${m.role.toUpperCase()}: ${m.content}`),
  ].filter(Boolean).join("\n\n");
  const source = unboundedSource.slice(0, 24000);
  if (unboundedSource.length > source.length) {
    // Do not log conversation content; only record that bounded input was truncated.
    console.warn(`History compression input truncated: ${unboundedSource.length} chars to ${source.length}`);
  }

  const result = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: "Sažmi razgovor na srpskom u najviše 5 kratkih rečenica. Sačuvaj činjenice, brojeve, imena, ograničenja i odluke. Ne izmišljaj podatke. Vrati samo sažetak." },
      { role: "user", content: source },
    ],
  });
  const summary = typeof result?.response === "string" ? result.response.trim() : "";
  if (!summary || summary.length > MAX_SUMMARY_CHARS) return null;
  return summary;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    // Parse the allowlist once per request; do not cache mutable environment config globally.
    const requestAllowedOrigins = allowedOrigins(env);
    const originAllowed = isAllowedOrigin(origin, requestAllowedOrigins);
    const isApi = url.pathname === "/api/chat";

    // Safe diagnostics: never log prompts, cookies, IP addresses, origins, or secret values.
    if (isApi) {
      console.info("CEOAI_DIAG request_received", JSON.stringify({
        method: request.method,
        originAllowed,
        aiEnabled: env.AI_ENABLED === "true",
        externalAiEnabled: env.EXTERNAL_AI_ENABLED === "true",
      }));
    }

    if (!env.KV_MEMORY) {
      console.error("Missing KV_MEMORY binding");
      return new Response("Server misconfiguration.", {
        status: 500, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    }

    if (request.method === "OPTIONS" && isApi) {
      if (!originAllowed) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      return new Response(null, { status: 204, headers: { ...corsHeaders(origin), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }

    if (url.pathname === "/" && request.method === "GET") {
      let sessionId = getCookie(request, "ceoai_session");
      let existing = false;
      if (validUuid(sessionId)) {
        try { existing = (await env.KV_MEMORY.get(`session:${sessionId}`)) === "1"; } catch {}
      }
      const nonce = crypto.randomUUID().replace(/-/g, "");
      const page = HTML_PAGE.replaceAll("__NONCE__", nonce);
      const headers = new Headers({
        "Content-Type": "text/html; charset=UTF-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      });
      if (!existing) {
        sessionId = crypto.randomUUID();
        try {
          await env.KV_MEMORY.put(`session:${sessionId}`, "1", { expirationTtl: SESSION_TTL });
        } catch {
          return new Response("Session service unavailable.", { status: 503, headers: { "Cache-Control": "no-store" } });
        }
        const secure = url.protocol === "https:" ? "; Secure" : "";
        headers.append("Set-Cookie", `ceoai_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL}${secure}`);
      }
      return new Response(page, { status: 200, headers });
    }

    if (url.pathname !== "/api/chat") {
      return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    if (request.method !== "POST") {
      return json({ success: false, error: "Metod nije podržan." }, 405, originAllowed ? corsHeaders(origin) : {});
    }
    if (!originAllowed) {
      return json({ success: false, error: "Zabranjen zahtev." }, 403);
    }
    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json({ success: false, error: "Očekuje se JSON zahtev." }, 415, corsHeaders(origin));
    }

    const sessionId = getCookie(request, "ceoai_session");
    if (!validUuid(sessionId)) {
      return json({ success: false, error: "Sesija nedostaje ili je istekla. Osvežite stranicu." }, 401, corsHeaders(origin));
    }
    try {
      if ((await env.KV_MEMORY.get(`session:${sessionId}`)) !== "1") {
        return json({ success: false, error: "Sesija je istekla. Osvežite stranicu." }, 401, corsHeaders(origin));
      }
    } catch {
      return json({ success: false, error: "Servis sesije je privremeno nedostupan." }, 503, corsHeaders(origin));
    }

    const contentLength = Number(request.headers.get("Content-Length") || "0");
    if (contentLength > MAX_REQUEST_BYTES) {
      return json({ success: false, error: "Zahtev je prevelik." }, 413, corsHeaders(origin));
    }

    let rawBody;
    try {
      rawBody = await readBodyLimited(request, MAX_REQUEST_BYTES);
    } catch (error) {
      if (error?.status === 413 || error?.message === "REQUEST_BODY_TOO_LARGE") {
        return json({ success: false, error: "Zahtev je prevelik." }, 413, corsHeaders(origin));
      }
      if (error?.message === "INVALID_UTF8") {
        return json({ success: false, error: "Telo zahteva nije validan UTF-8 tekst." }, 400, corsHeaders(origin));
      }
      return json({ success: false, error: "Telo zahteva nije moglo biti pročitano." }, 400, corsHeaders(origin));
    }
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ success: false, error: "Neispravan JSON zahtev." }, 400, corsHeaders(origin));
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ success: false, error: "Telo zahteva mora biti JSON objekat." }, 400, corsHeaders(origin));
    }

    const prompt = body.prompt;
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) {
      return json({ success: false, error: "Poruka mora imati između 1 i 2000 karaktera." }, 400, corsHeaders(origin));
    }

    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) {
      return json({ success: false, error: "Nije moguće proveriti ograničenje zahteva." }, 503, corsHeaders(origin));
    }
    try {
      const allowed = await enforceRateLimit(env, ip, Date.now());
      if (!allowed) {
        return json(
          { success: false, error: "Dostigli ste limit od 20 zahteva po satu. Pokušajte kasnije." },
          429,
          { ...corsHeaders(origin), "Retry-After": String(Math.ceil(RATE_WINDOW_MS / 1000)) }
        );
      }
    } catch {
      return json({ success: false, error: "Zaštita od preopterećenja je privremeno nedostupna." }, 503, corsHeaders(origin));
    }

    // Fail closed by default: external providers are never called unless BOTH flags are true.
    if (env.AI_ENABLED !== "true" || env.EXTERNAL_AI_ENABLED !== "true") {
      return json({
        success: false,
        error: "AI je isključen ili spoljne AI pozive vlasnik nije izričito omogućio. Nije poslat zahtev nijednom AI provajderu.",
      }, 503, corsHeaders(origin));
    }

    try {
      let memory;
      try {
        memory = await env.KV_MEMORY.get(`memory:${sessionId}`, "json");
      } catch {
        return json({ success: false, error: "Memorija je privremeno nedostupna; istorija nije promenjena." }, 503, corsHeaders(origin));
      }
      if (!memory || typeof memory !== "object" || !Array.isArray(memory.messages)) {
        memory = { messages: [], summary: null, estimatedTokensSaved: 0, compressions: 0 };
      }
      memory.summary = typeof memory.summary === "string" ? memory.summary.slice(0, MAX_SUMMARY_CHARS) : null;
      memory.estimatedTokensSaved = safeInteger(memory.estimatedTokensSaved);
      memory.compressions = safeInteger(memory.compressions);

      // Validate and bound the source before any compression. The summary sees up to
      // 64 recent stored messages; normal provider context is capped at 16 messages.
      // Stored memory is normally capped at 16, but this also defends against legacy data.
      const validatedHistory = memory.messages
        .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-MAX_HISTORY_INPUT_MESSAGES)
        .map(m => ({ role: m.role, content: m.content.slice(0, MAX_REPLY_CHARS) }));
      const oldMessages = validatedHistory.slice(-MAX_HISTORY_MESSAGES);

      let nextSummary = memory.summary;
      let workingMessages = [...oldMessages, { role: "user", content: prompt.trim() }];
      let didCompress = false;

      // Summarize OLD history only. The current prompt is never duplicated in the summary.
      if (validatedHistory.length >= COMPRESSION_THRESHOLD - 1 && env.AI_ENABLED === "true" &&
          env.EXTERNAL_AI_ENABLED === "true" && env.AI && env.WORKERS_AI_ENABLED === "true") {
        try {
          const summary = await compressHistory(env, nextSummary, validatedHistory);
          if (summary) {
            nextSummary = summary;
            workingMessages = [{ role: "user", content: prompt.trim() }];
            didCompress = true;
          }
        } catch (error) {
          console.warn("History compression failed; retaining existing history:", String(error?.message || error).slice(0, 160));
        }
      }

      if (workingMessages.length > MAX_HISTORY_MESSAGES) {
        return json({
          success: false,
          error: "Memorija je dostigla bezbedni limit, a kompresija nije uspela. Istorija je sačuvana; pokušajte kasnije.",
        }, 503, corsHeaders(origin));
      }

      const messages = [];
      messages.push({
        role: "system",
        content: "Ti si CEOAI, koristan i iskren asistent. Odgovaraj na srpskom osim ako korisnik traži drugi jezik. Ne tvrdi da si izvršio radnje ili testove koje nisi izvršio.",
      });
      if (nextSummary) messages.push({ role: "system", content: `SAŽETAK RANIJEG RAZGOVORA:\n${nextSummary}` });
      messages.push(...workingMessages);

      const intent = chooseIntent(prompt);
      const configuredComplexModel = typeof env.OPENROUTER_COMPLEX_MODEL === "string"
        ? env.OPENROUTER_COMPLEX_MODEL.trim() : "";
      if (configuredComplexModel && !(typeof env.OPENROUTER_KEY === "string" && env.OPENROUTER_KEY.trim()) && !warnedOpenRouterModelWithoutKey) {
        console.warn("OPENROUTER_COMPLEX_MODEL is configured but OPENROUTER_KEY is missing; optional candidate disabled.");
        warnedOpenRouterModelWithoutKey = true;
      }
      if (configuredComplexModel && !validOpenRouterFreeModel(configuredComplexModel) && !warnedInvalidOpenRouterModel) {
        console.warn("OPENROUTER_COMPLEX_MODEL is invalid; expected a model ID up to 200 characters ending in :free.");
        warnedInvalidOpenRouterModel = true;
      }
      const glmFlashModel = typeof env.ZAI_GLM_FLASH_MODEL === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(env.ZAI_GLM_FLASH_MODEL.trim())
        ? env.ZAI_GLM_FLASH_MODEL.trim() : "glm-4.5-flash";
      const pool = [
        // Both GLM keys use the same adapter and model; the second key is a fallback, never parallelized.
        { id: "glm-flash-1", provider: "glm-flash", model: glmFlashModel, key: env.ZAI_GLM_FLASH_KEY_1, tier: "fast" },
        { id: "glm-flash-2", provider: "glm-flash", model: glmFlashModel, key: env.ZAI_GLM_FLASH_KEY_2, tier: "fast" },
        { id: "gemini-1", provider: "gemini", model: "gemini-1.5-flash", key: env.GEMINI_KEY_1, tier: "fast" },
        { id: "gemini-2", provider: "gemini", model: "gemini-1.5-flash", key: env.GEMINI_KEY_2, tier: "fast" },
        { id: "gemini-3", provider: "gemini", model: "gemini-1.5-flash", key: env.GEMINI_KEY_3, tier: "fast" },
        { id: "openrouter-1", provider: "openrouter", model: "meta-llama/llama-3-8b-instruct:free", key: env.OPENROUTER_KEY, tier: "fast" },
        { id: "deepseek-1", provider: "deepseek", model: "deepseek-chat", key: env.DEEPSEEK_KEY, tier: "complex" },
        // Optional second complex candidate. Configure only a verified :free OpenRouter model.
        ...(validOpenRouterFreeModel(configuredComplexModel) && typeof env.OPENROUTER_KEY === "string" && env.OPENROUTER_KEY.trim()
          ? [{ id: "openrouter-complex-free", provider: "openrouter", model: configuredComplexModel, key: env.OPENROUTER_KEY, tier: "complex" }]
          : []),
      ].filter(p => typeof p.key === "string" && p.key.trim());

      // Explicit GLM-only mode is intended for controlled provider verification.
      // When enabled, neither normal fallback nor complex-intent routing may call another provider.
      const candidates = env.ZAI_GLM_FLASH_ONLY === "true"
        ? pool.filter(p => p.provider === "glm-flash")
        : pool.filter(p => p.tier === intent || p.tier === "fast");
      console.info("CEOAI_DIAG provider_pool", JSON.stringify({
        glmOnly: env.ZAI_GLM_FLASH_ONLY === "true",
        hasGlmKey1: typeof env.ZAI_GLM_FLASH_KEY_1 === "string" && Boolean(env.ZAI_GLM_FLASH_KEY_1.trim()),
        hasGlmKey2: typeof env.ZAI_GLM_FLASH_KEY_2 === "string" && Boolean(env.ZAI_GLM_FLASH_KEY_2.trim()),
        configuredProviderCount: pool.length,
        candidateCount: candidates.length,
        intent,
      }));
      if (!candidates.length) {
        console.warn("CEOAI_DIAG no_provider_candidates", JSON.stringify({
          glmOnly: env.ZAI_GLM_FLASH_ONLY === "true",
          hasGlmKey1: typeof env.ZAI_GLM_FLASH_KEY_1 === "string" && Boolean(env.ZAI_GLM_FLASH_KEY_1.trim()),
          hasGlmKey2: typeof env.ZAI_GLM_FLASH_KEY_2 === "string" && Boolean(env.ZAI_GLM_FLASH_KEY_2.trim()),
          configuredProviderCount: pool.length,
          intent,
        }));
        return json({ success: false, error: "Nema konfigurisanog provajdera. Nije moguće poslati zahtev." }, 503, corsHeaders(origin));
      }

      let reply = "";
      let providerSucceeded = false;
      let lastStatus = 0;
      let sawRateLimit = false;
      let sawCooldownSkip = false;
      for (const candidate of candidates) {
        const cooldownKey = `cooldown:${candidate.id}`;
        let coolingDown = false;
        try { coolingDown = Boolean(await env.KV_MEMORY.get(cooldownKey)); } catch {
          return json({ success: false, error: "Servis privremenih ograničenja je nedostupan." }, 503, corsHeaders(origin));
        }
        if (coolingDown) { sawCooldownSkip = true; continue; }

        try {
          reply = await executeModel(candidate, messages);
          if (!reply.trim()) throw new Error("Prazan odgovor");
          providerSucceeded = true;
          break;
        } catch (error) {
          lastStatus = Number(error?.status) || 0;
          const msg = String(error?.message || "");
          console.warn(`Provider ${candidate.id} failed: ${msg.slice(0, 120)}`);
          if (env.DEBUG_PROVIDER_ERRORS === "true" && error?.providerDetail) {
            // Provider detail is bounded and credential-redacted; debug logging is opt-in.
            console.debug(`Provider ${candidate.id} detail: ${String(error.providerDetail).slice(0, 600)}`);
          }
          if (lastStatus === 429) {
            sawRateLimit = true;
            try { await env.KV_MEMORY.put(cooldownKey, "1", { expirationTtl: COOLDOWN_TTL }); } catch {}
          }
        }
      }

      if (!providerSucceeded) {
        const rateLimited = sawRateLimit || sawCooldownSkip;
        const message = rateLimited
          ? "Provajderi su dostigli ograničenje ili čekaju da istekne privremeno ograničenje. Pokušajte kasnije."
          : "AI provajderi trenutno nisu dostupni. Istorija razgovora nije promenjena.";
        // 429 cooldown is one hour; transient upstream failures get a conservative 120-second retry hint.
        return json({ success: false, error: message }, 503, {
          ...corsHeaders(origin),
          // A newly observed 429 has a one-hour cooldown; a pre-existing cooldown gets a conservative retry hint.
          "Retry-After": sawRateLimit ? String(COOLDOWN_TTL) : "120",
        });
      }

      const nextMessages = [...workingMessages, { role: "assistant", content: reply }];
      const nextMemory = {
        summary: nextSummary,
        messages: nextMessages.slice(-MAX_HISTORY_MESSAGES),
        // Cumulative estimate over validatedHistory (up to 64 input messages), not only the 16-message persisted window.
        estimatedTokensSaved: memory.estimatedTokensSaved + (didCompress ? Math.max(0, estimateTokens(validatedHistory.map(m => m.content).join("\n")) - estimateTokens(nextSummary)) : 0),
        compressions: memory.compressions + (didCompress ? 1 : 0),
      };
      try {
        await env.KV_MEMORY.put(`memory:${sessionId}`, JSON.stringify(nextMemory), { expirationTtl: SESSION_TTL });
      } catch {
        // Do not claim success if persistence failed.
        return json({ success: false, error: "Odgovor je generisan, ali memorija nije mogla biti sačuvana. Pokušajte ponovo." }, 503, corsHeaders(origin));
      }

      return json({
        success: true,
        reply,
        stats: {
          msgs: nextMemory.messages.length,
          hasSummary: Boolean(nextMemory.summary),
          estimatedTokensSaved: nextMemory.estimatedTokensSaved,
          compressions: nextMemory.compressions,
          messagesLeft: Math.max(0, COMPRESSION_THRESHOLD - nextMemory.messages.length),
        },
      }, 200, corsHeaders(origin));
    } catch (error) {
      console.error("Chat request failed:", String(error?.message || error).slice(0, 180));
      return json({ success: false, error: "Interna greška pri obradi zahteva." }, 500, corsHeaders(origin));
    }
  },
};
