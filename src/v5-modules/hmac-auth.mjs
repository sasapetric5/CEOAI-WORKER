// CEOAI V5.1 — HMAC-SHA256 app-to-app request authentication.
// Replay protection is mandatory: requests fail closed without SECURITY_DO.
const NONCE_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
const BASE64_STANDARD = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_URL = /^[A-Za-z0-9_-]+={0,2}$/;
const MAX_CLOCK_SKEW_SECONDS = 300;

function invalid(status = 401) {
  return { valid: false, status, error: "Authentication failed" };
}

function unavailable() {
  return { valid: false, status: 503, error: "Authentication service unavailable" };
}

function allowedApp(appId, env) {
  if (typeof appId !== "string" || !/^[A-Z][A-Z0-9_-]{1,63}$/.test(appId)) return false;
  const configured = typeof env.HMAC_ALLOWED_APPS === "string"
    ? env.HMAC_ALLOWED_APPS.split(",").map(value => value.trim()).filter(Boolean)
    : Array.isArray(env.HMAC_ALLOWED_APPS) ? env.HMAC_ALLOWED_APPS : [];
  return configured.includes(appId);
}

function decodeSignature(value) {
  if (typeof value !== "string" || value.length < 43 || value.length > 44) return null;
  const isStandard = BASE64_STANDARD.test(value);
  const isUrl = BASE64_URL.test(value);
  if (!isStandard && !isUrl) return null;
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (normalized.length !== 43) return null;
  try {
    const binary = atob(normalized + "=");
    if (binary.length !== 32) return null;
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    let canonical = btoa(String.fromCharCode(...bytes));
    if (isUrl) canonical = canonical.replace(/\+/g, "-").replace(/\//g, "_");
    canonical = canonical.replace(/=+$/, "");
    return canonical === value.replace(/=+$/, "") ? bytes : null;
  } catch {
    return null;
  }
}

function bytesFrom(rawBuffer) {
  if (rawBuffer instanceof ArrayBuffer) return new Uint8Array(rawBuffer);
  if (ArrayBuffer.isView(rawBuffer)) {
    return new Uint8Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength);
  }
  return null;
}

export async function verifyHmacSignature(request, rawBuffer, env) {
  try {
    if (!request || !env || !globalThis.crypto?.subtle) return unavailable();

    const appId = request.headers.get("X-App-Id");
    const timestampStr = request.headers.get("X-Timestamp");
    const nonce = request.headers.get("X-Nonce");
    const signatureText = request.headers.get("X-Signature");

    if (!allowedApp(appId, env) || !timestampStr || !nonce || !signatureText) return invalid();
    if (!/^\d{10}$/.test(timestampStr) || !NONCE_REGEX.test(nonce)) return invalid();

    const requestTime = Number(timestampStr);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(requestTime) || Math.abs(now - requestTime) > MAX_CLOCK_SKEW_SECONDS) return invalid();

    const signatureBytes = decodeSignature(signatureText);
    if (!signatureBytes) return invalid();

    const secretName = `APP_SECRET_${appId.replace(/-/g, "_")}`;
    const secret = env[secretName];
    if (typeof secret !== "string" || secret.trim().length < 32) return unavailable();

    const bodyBytes = bytesFrom(rawBuffer);
    if (!bodyBytes) return invalid(400);

    const bodyHash = await crypto.subtle.digest("SHA-256", bodyBytes);
    const bodyHashHex = Array.from(new Uint8Array(bodyHash), byte => byte.toString(16).padStart(2, "0")).join("");
    const url = new URL(request.url);
    const canonical = [request.method.toUpperCase(), url.pathname, timestampStr, nonce, bodyHashHex].join("\n");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(canonical));
    if (!valid) return invalid();

    // Nonce persistence is mandatory; no in-memory fallback is safe across Worker isolates.
    if (!env.SECURITY_DO || typeof env.SECURITY_DO.idFromName !== "function" || typeof env.SECURITY_DO.get !== "function") return unavailable();

    let nonceResponse;
    try {
      const id = env.SECURITY_DO.idFromName(`nonce:${appId}`);
      const stub = env.SECURITY_DO.get(id);
      nonceResponse = await stub.fetch("https://do/nonce/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, nonce, timestamp: requestTime })
      });
    } catch {
      return unavailable();
    }

    if (!nonceResponse) return unavailable();
    if (nonceResponse.status >= 500) return unavailable();
    if (!nonceResponse.ok) return invalid();

    return { valid: true, appId, nonce, timestamp: requestTime };
  } catch {
    return unavailable();
  }
}
