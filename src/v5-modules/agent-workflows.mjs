// CEOAI V5.0 — executable, deterministic cross-app workflows.
// These are real local workflows (not catalog entries): validate input, run bounded
// domain checks, produce evidence and a machine-readable result. No network, model,
// filesystem, publishing, purchases, or other external side effects are performed.
const MAX_INPUT_CHARS = 12000;
const MAX_ITEMS = 100;

const fail = (code, message) => ({ ok: false, code, message });
const pass = (code, message, details = {}) => ({ ok: true, code, message, details });

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function textField(value, name, max = 4000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new TypeError(name + " must be a non-empty string up to " + max + " characters");
  }
  return value.trim();
}
function listField(value, name, max = MAX_ITEMS) {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(name + " must be an array of at most " + max + " items");
  return value;
}
function result(workflowId, app, checks, summary, artifacts = {}) {
  const failed = checks.filter(x => x.ok === false).length;
  const warnings = checks.filter(x => x.severity === "warning").length;
  const blockingFailures = checks.filter(x => x.ok === false && x.severity !== "warning").length;
  return Object.freeze({
    schema_version: "1.0.0", workflow_id: workflowId, app,
    status: blockingFailures ? "needs-attention" : warnings ? "passed-with-warnings" : "passed",
    summary, checks, artifacts,
    check_count: checks.length, failed_count: failed, warning_count: warnings,
    external_actions_performed: false, paid_services_used: false,
    network_access_used: false, execution_mode: "local-deterministic",
  });
}

function contentBrief(input) {
  const topic = textField(input.topic, "topic", 500);
  const audience = textField(input.audience, "audience", 300);
  const goal = textField(input.goal, "goal", 300);
  const channels = listField(input.channels ?? ["website"], "channels", 10)
    .map((x, i) => textField(x, "channels[" + i + "]", 60));
  const forbidden = listField(input.must_avoid ?? [], "must_avoid", 30)
    .map((x, i) => textField(x, "must_avoid[" + i + "]", 200));
  const brief = {
    topic, audience, goal, channels,
    required_sections: ["audience problem", "value proposition", "evidence or examples", "clear next step"],
    quality_gates: ["claims need evidence", "no fabricated statistics", "language matches audience", "human review before publication"],
    must_avoid: forbidden,
  };
  return result("contentcraft.content-brief", "contentcraft", [
    pass("topic-valid", "Tema je validan."),
    pass("audience-defined", "Ciljna publika je navedena."),
    pass("goal-defined", "Cilj sadržaja je naveden."),
    pass("publication-gate", "Objavljivanje nije izvršeno; potrebna je ljudska provera."),
  ], "Kreiran je proverljiv brief za sadržaj.", { brief });
}

function seoChecklist(input) {
  const url = textField(input.url, "url", 2048);
  let parsed;
  try { parsed = new URL(url); } catch { throw new TypeError("url must be an absolute HTTP(S) URL"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError("url must be HTTP(S) and must not contain embedded credentials");
  }
  const page = plainObject(input.page) ? input.page : {};
  const checks = [
    (typeof page.title === "string" && page.title.trim()) ? pass("title-present", "Naslov stranice postoji.") : { ...fail("title-missing", "Nedostaje naslov stranice."), severity: "warning" },
    (typeof page.description === "string" && page.description.trim()) ? pass("description-present", "Meta opis postoji.") : { ...fail("description-missing", "Nedostaje meta opis."), severity: "warning" },
    (typeof page.h1Count === "number" && page.h1Count === 1) ? pass("single-h1", "Pronađen je tačno jedan H1.") : { ...fail("h1-count", "Broj H1 elemenata nije potvrđen kao tačno jedan."), severity: "warning" },
    (typeof page.imagesWithoutAlt === "number" && page.imagesWithoutAlt === 0) ? pass("image-alt", "Sve prijavljene slike imaju alt tekst.") : { ...fail("image-alt-review", "Alt tekst slika nije potvrđen ili postoje slike bez alt teksta."), severity: "warning" },
    (typeof page.canonical === "string" && page.canonical.trim()) ? pass("canonical-present", "Canonical URL je naveden.") : { ...fail("canonical-unverified", "Canonical URL nije potvrđen."), severity: "warning" },
    (page.robotsIndexable === true) ? pass("indexability", "Ulazni podatak kaže da je stranica indeksabilna.") : { ...fail("indexability-unverified", "Indeksabilnost nije potvrđena."), severity: "warning" },
  ];
  return result("rankgeo.seo-checklist", "rankgeo", checks, "SEO kontrolna lista obrađena iz dostavljenih podataka; URL nije posećen.", {
    target_url: parsed.origin + parsed.pathname, evidence_source: "caller-supplied-page-metadata",
    missing_or_unverified: checks.filter(x => !x.ok).map(x => x.code),
  });
}

function providerHealth(input) {
  const providers = listField(input.providers, "providers");
  const seen = new Set();
  const normalized = providers.map((p, i) => {
    if (!plainObject(p)) throw new TypeError("providers[" + i + "] must be an object");
    const id = textField(p.id, "providers[" + i + "].id", 100).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(id) || seen.has(id)) throw new TypeError("provider ids must be unique safe identifiers");
    seen.add(id);
    const status = ["healthy", "degraded", "unavailable", "unknown"].includes(p.status) ? p.status : "unknown";
    const latencyMs = Number.isFinite(p.latencyMs) && p.latencyMs >= 0 ? p.latencyMs : null;
    return { id, status, latency_ms: latencyMs, free_quota_confirmed: p.freeQuotaConfirmed === true };
  });
  const usable = normalized.filter(p => p.status === "healthy" && p.free_quota_confirmed);
  const checks = [
    usable.length ? pass("free-provider-available", "Postoji bar jedan zdrav provajder sa potvrđenom besplatnom kvotom.", { count: usable.length }) : { ...fail("no-confirmed-free-provider", "Nema provajdera koji istovremeno ima status healthy i potvrđenu besplatnu kvotu."), severity: "warning" },
    normalized.every(p => p.status !== "unknown") ? pass("provider-status-known", "Status svih provajdera je poznat.") : { ...fail("unknown-provider-status", "Jedan ili više statusa nisu provereni."), severity: "warning" },
  ];
  return result("ceoai.provider-health", "ceoai", checks, "Zdravlje provajdera sažeto iz prosleđenih podataka; nijedan API nije pozvan.", {
    providers: normalized, eligible_free_provider_ids: usable.map(p => p.id),
    routing_recommendation: usable.length ? usable.sort((a,b) => (a.latency_ms ?? Infinity) - (b.latency_ms ?? Infinity))[0].id : null,
  });
}

function validateListings(input) {
  const listings = listField(input.listings, "listings");
  const seen = new Set();
  const rows = listings.map((item, i) => {
    if (!plainObject(item)) throw new TypeError("listings[" + i + "] must be an object");
    const id = textField(item.id, "listings[" + i + "].id", 100);
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const location = typeof item.location === "string" ? item.location.trim() : "";
    const url = typeof item.url === "string" ? item.url.trim() : "";
    const duplicate = seen.has(id.toLowerCase()); seen.add(id.toLowerCase());
    const checks = [
      duplicate ? fail("duplicate-id", "ID zapisa se ponavlja.") : pass("unique-id", "ID zapisa je jedinstven."),
      name ? pass("name-present", "Naziv je naveden.") : fail("name-missing", "Nedostaje naziv."),
      location ? pass("location-present", "Lokacija je navedena.") : fail("location-missing", "Nedostaje lokacija."),
      (() => { try { const u = new URL(url); return ["http:", "https:"].includes(u.protocol) ? pass("url-valid", "URL je validan.") : fail("url-invalid", "URL mora koristiti HTTP(S)."); } catch { return fail("url-invalid", "URL nije validan."); } })(),
    ];
    return { id, status: checks.every(c => c.ok) ? "valid" : "needs-review", checks };
  });
  const invalid = rows.filter(x => x.status !== "valid").length;
  return result("rankgeo.listing-validation", "rankgeo", [
    invalid ? { ...fail("listing-review-required", "Neki zapisi zahtevaju ispravku.", { invalid_count: invalid }), severity: "warning" } : pass("all-listings-valid", "Svi zapisi prolaze osnovne validacije."),
  ], "Lokalna validacija listing podataka je završena; ništa nije objavljeno.", { listings: rows });
}

function safeJobReview(input) {
  if (!plainObject(input.job)) throw new TypeError("job must be an object");
  const job = input.job;
  const checks = [];
  const timeout = job.timeoutMs;
  checks.push(Number.isInteger(timeout) && timeout >= 100 && timeout <= 30000
    ? pass("timeout-bounded", "Vremensko ograničenje je unutar 100–30000 ms.")
    : fail("timeout-out-of-range", "Vremensko ograničenje mora biti 100–30000 ms."));
  checks.push(job.networkAccess === false ? pass("network-disabled", "Mrežni pristup je isključen.") : fail("network-not-disabled", "Posao mora eksplicitno isključiti mrežni pristup."));
  checks.push(job.privileged !== true ? pass("not-privileged", "Privilegovani režim nije zatražen.") : fail("privileged-forbidden", "Privilegovani režim nije dozvoljen."));
  checks.push(job.hostMounts !== true ? pass("no-host-mounts", "Host bind mount nije zatražen.") : fail("host-mount-forbidden", "Host bind mount nije dozvoljen."));
  checks.push(job.dockerSocket !== true ? pass("no-docker-socket", "Docker socket nije zatražen.") : fail("docker-socket-forbidden", "Docker socket nije dozvoljen."));
  checks.push(job.paidService !== true ? pass("free-only", "Nije označena plaćena usluga.") : fail("paid-service-forbidden", "Plaćena usluga nije dozvoljena."));
  checks.push(job.externalAction !== true ? pass("no-external-action", "Nije zatražena spoljašnja radnja.") : fail("external-action-forbidden", "Spoljašnja radnja zahteva izričito odobrenje i nije izvršena."));
  return result("safe-automaton.job-policy-review", "safe-automaton", checks,
    checks.every(x => x.ok) ? "Posao prolazi statičku bezbednosnu proveru; nije pokrenut." : "Posao je blokiran ili zahteva ispravku; nije pokrenut.",
    { eligible_for_execution: checks.every(x => x.ok), execution_started: false });
}

function aiForcePromptReview(input) {
  const prompt = textField(input.prompt, "prompt", MAX_INPUT_CHARS);
  const issues = [];
  if (/\b(ignore (all )?(previous|prior) instructions|reveal (the )?(system prompt|secrets)|developer message)\b/i.test(prompt)) issues.push("possible-instruction-override");
  if (/\b(api[_ -]?key|password|secret|bearer\s+[a-z0-9._-]{12,})\b/i.test(prompt)) issues.push("possible-secret-reference");
  if (/\b(send|publish|purchase|delete|apply|email|post)\b/i.test(prompt)) issues.push("possible-external-side-effect");
  const checks = [
    issues.includes("possible-instruction-override") ? { ...fail("prompt-injection-review", "Moguć pokušaj nadjačavanja instrukcija; potrebna je provera."), severity: "warning" } : pass("instruction-boundary", "Nije prepoznat očigledan obrazac nadjačavanja instrukcija."),
    issues.includes("possible-secret-reference") ? { ...fail("secret-review", "Moguće pominjanje tajne; uklonite stvarne tajne iz prompta."), severity: "warning" } : pass("secret-screen", "Nije prepoznat očigledan obrazac tajne."),
    issues.includes("possible-external-side-effect") ? { ...fail("side-effect-review", "Tekst možda traži spoljašnju radnju; odobrenje je obavezno."), severity: "warning" } : pass("side-effect-boundary", "Nije prepoznat očigledan zahtev za spoljašnju radnju."),
  ];
  return result("aiforce.prompt-safety-review", "aiforce", checks, "Prompt je proverен heuristikama; nije poslat modelu.", {
    findings: issues, prompt_length: prompt.length, prompt_content_stored: false,
  });
}

const WORKFLOWS = Object.freeze({
  "contentcraft.content-brief": { app: "contentcraft", run: contentBrief },
  "rankgeo.seo-checklist": { app: "rankgeo", run: seoChecklist },
  "ceoai.provider-health": { app: "ceoai", run: providerHealth },
  "rankgeo.listing-validation": { app: "rankgeo", run: validateListings },
  "safe-automaton.job-policy-review": { app: "safe-automaton", run: safeJobReview },
  "aiforce.prompt-safety-review": { app: "aiforce", run: aiForcePromptReview },
});

export function listExecutableWorkflows() {
  return Object.entries(WORKFLOWS).map(([id, value]) => ({
    id, app: value.app, execution_mode: "local-deterministic",
    network_access: false, paid_services: false, external_actions: false,
  }));
}

export function executeAgentWorkflow(workflowId, input) {
  if (typeof workflowId !== "string" || !Object.hasOwn(WORKFLOWS, workflowId)) {
    throw new RangeError("Unknown or non-executable workflow");
  }
  if (!plainObject(input)) throw new TypeError("input must be a plain object");
  const raw = JSON.stringify(input);
  if (raw.length > MAX_INPUT_CHARS) throw new RangeError("input exceeds maximum serialized size");
  return WORKFLOWS[workflowId].run(input);
}
