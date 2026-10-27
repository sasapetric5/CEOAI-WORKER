/** Normalize aggregate Umami analytics only; never returns visitor-level data. */
const MAX_BYTES = 2_000_000;
const MAX_ROWS = 500;
function record(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function label(v) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0,160) || null : null; }
function count(v) { return Number.isSafeInteger(v) && v >= 0 ? v : null; }
export function normalizeUmamiAggregate(input) {
  let data=input;
  if (typeof input==="string") {
    if (new TextEncoder().encode(input).byteLength>MAX_BYTES) return {ok:false,code:"UMAMI_REPORT_TOO_LARGE"};
    try { data=JSON.parse(input); } catch { return {ok:false,code:"UMAMI_INVALID_JSON"}; }
  } else if (!record(input)) return {ok:false,code:"UMAMI_INVALID_SHAPE"};
  if (!record(data)) return {ok:false,code:"UMAMI_INVALID_SHAPE"};
  const raw = data.data ?? data;
  const stats = {};
  if (record(raw)) {
    for (const key of ["visitors","visits","pageviews","views","bounces","totaltime"]) {
      if (raw[key] === undefined) continue;
      const n=count(raw[key]);
      if (n!==null) stats[key==="views"?"pageviews":key]=n;
    }
  }
  const rowsInput=Array.isArray(raw) ? raw : (Array.isArray(raw?.rows)?raw.rows:null);
  let rows=[];
  if (rowsInput) {
    if (rowsInput.length>MAX_ROWS) return {ok:false,code:"UMAMI_TOO_MANY_ROWS"};
    rows=rowsInput.filter(record).map(row=>{
      const name=label(row.x ?? row.name ?? row.path ?? row.label);
      const value=count(row.y ?? row.value ?? row.visits ?? row.pageviews);
      return name && value!==null ? {label:name,value} : null;
    }).filter(Boolean);
  }
  if (!Object.keys(stats).length && !rows.length) return {ok:false,code:"UMAMI_EMPTY_AGGREGATE"};
  return {ok:true,source:"UMAMI_AGGREGATE",stats,rows,startAt:label(data.startAt ?? raw?.startAt),endAt:label(data.endAt ?? raw?.endAt)};
}
