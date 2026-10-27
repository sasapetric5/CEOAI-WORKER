/** Normalize read-only SerpBear keyword-position data. No network calls or mutations. */
const MAX_BYTES = 2_000_000;
const MAX_ROWS = 1000;
const MAX_TEXT = 180;
function record(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function text(v) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) || null : null; }
function date(v) {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = typeof v === "number" ? v : Date.parse(v);
  if (!Number.isFinite(n)) return null;
  const d = new Date(typeof v === "number" && n < 10_000_000_000 ? n * 1000 : n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function position(v) { return Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000 ? v : null; }
export function normalizeSerpBearResult(input) {
  let data = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > MAX_BYTES) return { ok:false, code:"SERPBEAR_REPORT_TOO_LARGE" };
    try { data = JSON.parse(input); } catch { return { ok:false, code:"SERPBEAR_INVALID_JSON" }; }
  } else if (!record(input) && !Array.isArray(input)) return { ok:false, code:"SERPBEAR_INVALID_SHAPE" };
  if (record(data)) data = data.data ?? data.keywords ?? data.results;
  if (!Array.isArray(data) || data.length === 0) return { ok:false, code:"SERPBEAR_INVALID_SHAPE" };
  if (data.length > MAX_ROWS) return { ok:false, code:"SERPBEAR_TOO_MANY_ROWS" };
  const rows = [];
  let rejected = 0;
  for (const item of data) {
    if (!record(item)) { rejected++; continue; }
    const keyword = text(item.keyword ?? item.query);
    const domain = text(item.domain ?? item.website);
    const rawPosition = item.position ?? item.rank ?? item.currentPosition;
    const rank = rawPosition === null || rawPosition === undefined ? null : position(rawPosition);
    if (!keyword || !domain || (rawPosition !== null && rawPosition !== undefined && rank === null)) { rejected++; continue; }
    rows.push({ keyword, domain, position: rank, checkedAt: date(item.checkedAt ?? item.checked_at ?? item.date ?? item.updatedAt), source: "SERPBEAR" });
  }
  return { ok:true, source:"SERPBEAR_READ_ONLY", count:rows.length, rejectedRows:rejected, rows };
}
