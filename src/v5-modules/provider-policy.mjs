// CEOAI V5.0 provider policy primitives inspired by health-aware gateway patterns.
// Pure functions only: safe to test without network calls or provider credentials.
export const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

export function parseRetryAfterSeconds(value, nowMs = Date.now(), maxSeconds = MAX_RETRY_AFTER_SECONDS) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^[0-9]+$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
    return Math.min(seconds, maxSeconds);
  }
  // Validate the full HTTP-date instead of relying on Date.parse normalizing invalid dates.
  const match = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([0-9]{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/.exec(raw);
  if (!match) return null;
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const [, weekday, dayText, monthText, yearText, hourText, minuteText, secondText] = match;
  const day = Number(dayText), year = Number(yearText), hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const at = Date.UTC(year, months[monthText], day, hour, minute, second);
  const date = new Date(at);
  if (!Number.isFinite(at) || date.getUTCFullYear() !== year || date.getUTCMonth() !== months[monthText] ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute ||
      date.getUTCSeconds() !== second ||
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()] !== weekday) return null;
  const seconds = Math.ceil((at - nowMs) / 1000);
  if (seconds <= 0) return 0;
  return Math.min(seconds, maxSeconds);
}

export function providerFailureCooldown({ status = 0, quotaExhausted = false, retryAfterSeconds = null } = {}) {
  const code = Number(status) || 0;
  if (quotaExhausted) return { ttl: 6 * 60 * 60, reason: "quota_exhausted" };
  if (code === 429) {
    const hinted = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? Math.min(retryAfterSeconds, MAX_RETRY_AFTER_SECONDS)
      : 0;
    return { ttl: Math.max(60, hinted), reason: "rate_limited" };
  }
  if (code === 401 || code === 403) return { ttl: 60 * 60, reason: "provider_auth_or_policy" };
  if (code === 404) return { ttl: 6 * 60 * 60, reason: "provider_model_unavailable" };
  if (code >= 500) return { ttl: 5 * 60, reason: "provider_server_error" };
  if (code === 0) return { ttl: 60, reason: "provider_timeout_or_network" };
  return null;
}
