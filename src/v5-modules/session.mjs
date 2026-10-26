// CEOAI V5.0 modular session controls. KV locking is best-effort, not atomic.
export const DEFAULT_COOKIE = "ceoai_session";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaults = { cookieName: DEFAULT_COOKIE, sessionKey: id => `session:${id}`, memoryKey: id => `memory:${id}` };
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const respond = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
export function readSessionId(request, cookieName = DEFAULT_COOKIE) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) { const [name, ...rest] = part.trim().split("="); if (name === cookieName) { const value = rest.join("="); return UUID_RE.test(value) ? value : null; } }
  return null;
}
export function parseAllowedOrigins(env) { return String(env?.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean); }
export async function handleMemoryReset(request, env, options = {}) {
  const o = { ...defaults, ...options };
  if (request.method !== "POST") return respond({ success: false, error: "Metoda nije dozvoljena." }, 405, { Allow: "POST" });
  const origin = request.headers.get("Origin");
  if (!origin || !parseAllowedOrigins(env).includes(origin)) return respond({ success: false, error: "Zabranjen zahtev." }, 403);
  const id = readSessionId(request, o.cookieName);
  if (!id) return respond({ success: false, error: "Sesija nedostaje." }, 401);
  if (!env?.KV_MEMORY || typeof env.KV_MEMORY.get !== "function" || typeof env.KV_MEMORY.delete !== "function") return respond({ success: false, error: "Usluga nije dostupna." }, 503);
  let exists = false;
  try { exists = (await env.KV_MEMORY.get(o.sessionKey(id))) === "1"; } catch { return respond({ success: false, error: "Usluga nije dostupna." }, 503); }
  if (!exists) return respond({ success: false, error: "Sesija nije važeća." }, 401);
  try { await env.KV_MEMORY.delete(o.memoryKey(id)); } catch { return respond({ success: false, error: "Brisanje nije uspelo." }, 503); }
  return respond({ success: true });
}
export async function limitSessionCreation(request, env) {
  if (!env?.RATE_LIMITER?.limit) return { ok: true, retryAfter: 0 };
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  try { const result = await env.RATE_LIMITER.limit({ key: `page:${ip}` }); return result.success ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: 60 }; }
  catch { return { ok: true, retryAfter: 0 }; }
}
export async function withSessionLock(kv, id, fn) {
  const key = `lock:${id}`;
  if (await kv.get(key)) return { busy: true };
  const token = crypto.randomUUID();
  await kv.put(key, token, { expirationTtl: 60 });
  if ((await kv.get(key)) !== token) return { busy: true };
  try { return { busy: false, value: await fn() }; }
  finally { try { if ((await kv.get(key)) === token) await kv.delete(key); } catch { /* lock expires */ } }
}
