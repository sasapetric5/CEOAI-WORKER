// Redact credentials before provider diagnostics can reach logs or error objects.
const SECRET_ENV_NAME = /(?:API[_-]?KEY|[_-]KEY(?:[_-]?\d+)?|TOKEN|SECRET|PASSWORD|CREDENTIAL|ACCESS[_-]?TOKEN|AUTH)/i;
const SECRET_FIELD = /\b(x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer|token|client[_-]?secret|password|secret|key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/ig;

export function redactSensitiveText(value, env = {}) {
  let text = String(value ?? "").slice(0, 1200);
  const secrets = [];
  if (env && typeof env === "object") {
    for (const [name, secret] of Object.entries(env)) {
      if (SECRET_ENV_NAME.test(name) && typeof secret === "string" && secret.trim().length >= 8) {
        secrets.push(secret.trim());
      }
    }
  }
  secrets.sort((a, b) => b.length - a.length);
  for (const secret of secrets) text = text.split(secret).join("[redacted]");
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/ig, "Bearer [redacted]")
    .replace(SECRET_FIELD, "$1=[redacted]")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|key|signature|sig|password|secret)=)[^&#\s]*/ig, "$1[redacted]");
}
