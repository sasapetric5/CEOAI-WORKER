// CEOAI V5.1 — bounded PII and secret redaction for diagnostic logs.
const REDACTED = "[REDACTED]";
const SAFE_TOKEN_COUNTERS = new Set(["maxtokens","maxoutputtokens","totaltokens","inputtokens","outputtokens","prompttokens","completiontokens","cachedtokens","tokencount","tokensused","tokenusage"]);
const EXACT_SENSITIVE = new Set(["email","phone","phonenumber","address","ipaddress","ssn","sessionid"]);
const SENSITIVE_PARTS = ["password","passwd","pwd","secret","token","authorization","credential","signature","nonce","apikey","accesskey","privatekey","clientkey","cookie"];
const MAX_DEPTH = 8, MAX_ENTRIES = 100, MAX_STRING = 4096;

export function isSensitiveKey(key) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SAFE_TOKEN_COUNTERS.has(normalized)) return false;
  return EXACT_SENSITIVE.has(normalized) || SENSITIVE_PARTS.some(part => normalized.includes(part));
}

function redactString(value) {
  let out = value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "...[TRUNCATED]" : value;
  const patterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[PRIVATE_KEY_REDACTED]"],
    [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
    [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[JWT_REDACTED]"],
    [/\bsk_(?:test|live)_[A-Za-z0-9_-]+/g, "[API_KEY_REDACTED]"],
    [/\b((?:authorization|password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token)\s*[:=]\s*["']?)[^"'&\s,;}]+/gi, "$1[REDACTED]"],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL_REDACTED]"],
    [/(?<![\w+])\+\d[\d\s().-]{7,}\d/g, "[PHONE_REDACTED]"],
  ];
  for (const [pattern, replacement] of patterns) out = out.replace(pattern, replacement);
  return out;
}

export function redactPII(input) {
  const ancestors = new Set();
  function visit(value, depth) {
    if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return redactString(value);
    if (typeof value === "bigint") return String(value) + "n";
    if (typeof value === "function" || typeof value === "symbol") return "[UNSERIALIZABLE]";
    if (depth >= MAX_DEPTH) return "[MAX_DEPTH_REACHED]";
    if (ancestors.has(value)) return "[CIRCULAR_REFERENCE]";
    ancestors.add(value);
    try {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[INVALID_DATE]" : value.toISOString();
      if (value instanceof Error) return { name: redactString(String(value.name)), message: redactString(String(value.message)) };
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return "[BINARY " + value.byteLength + " bytes]";
      if (value instanceof Map) return "[Map size=" + value.size + "]";
      if (value instanceof Set) return "[Set size=" + value.size + "]";
      if (Array.isArray(value)) {
        const out = [];
        for (let i = 0; i < Math.min(value.length, MAX_ENTRIES); i++) {
          const d = Object.getOwnPropertyDescriptor(value, String(i));
          out.push(!d ? null : ("value" in d ? visit(d.value, depth + 1) : "[ACCESSOR_OMITTED]"));
        }
        if (value.length > MAX_ENTRIES) out.push("[ARRAY_TRUNCATED]");
        return out;
      }
      const out = Object.create(null), keys = Object.keys(value);
      for (const key of keys.slice(0, MAX_ENTRIES)) {
        if (isSensitiveKey(key)) { out[key] = REDACTED; continue; }
        const d = Object.getOwnPropertyDescriptor(value, key);
        if (d) out[key] = "value" in d ? visit(d.value, depth + 1) : "[ACCESSOR_OMITTED]";
      }
      if (keys.length > MAX_ENTRIES) out["[truncated]"] = true;
      return out;
    } catch { return "[SANITIZATION_ERROR]"; }
    finally { ancestors.delete(value); }
  }
  try { return visit(input, 0); } catch { return "[SANITIZATION_ERROR]"; }
}

export const sanitizeLogData = redactPII;
