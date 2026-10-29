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


function taskIntake(input) {
  const objective = textField(input.objective, "objective", 1000);
  const constraints = listField(input.constraints ?? [], "constraints", 20).map((x,i)=>textField(x,"constraints["+i+"]",250));
  const acceptance = listField(input.acceptance_criteria ?? [], "acceptance_criteria", 15).map((x,i)=>textField(x,"acceptance_criteria["+i+"]",250));
  const risk = ["low","medium","high"].includes(input.risk) ? input.risk : "medium";
  const gates = ["no paid services", "no secrets in outputs", "no external side effects without approval", "verify outputs before completion"];
  return result("ceoai.task-intake","ceoai",[
    pass("objective-defined","Cilj zadatka je definisan."),
    pass("constraints-bounded","Ograničenja su normalizovana.",{count:constraints.length}),
    pass("acceptance-defined","Kriterijumi prihvatanja su normalizovani.",{count:acceptance.length}),
    risk==="high"?{...fail("high-risk-review","Zadatak visokog rizika zahteva ljudsku proveru."),severity:"warning"}:pass("risk-screen","Nije označen visok rizik.")
  ],"Zadatak je pretvoren u izvršiv nacrt; nijedna radnja nije pokrenuta.",{task:{objective,constraints,acceptance_criteria:acceptance,risk,safety_gates:gates,execution_authorized:false}});
}
function retryPlan(input) {
  const failures = listField(input.failures,"failures",30);
  const maxRetries = input.maxRetries ?? 2;
  if (!Number.isInteger(maxRetries)||maxRetries<0||maxRetries>3) throw new RangeError("maxRetries must be 0..3");
  const transient = new Set(["timeout","rate-limit","network","provider-unavailable"]);
  const plan = failures.map((f,i)=>{
    if(!plainObject(f)) throw new TypeError("failures["+i+"] must be an object");
    const kind=textField(f.kind,"failures["+i+"].kind",60).toLowerCase();
    const idempotent=f.idempotent===true;
    const retryable=transient.has(kind)&&idempotent&&maxRetries>0;
    return {index:i,kind,idempotent,retryable,retry_limit:retryable?maxRetries:0,reason:retryable?"transient-and-idempotent":"non-transient-or-not-idempotent"};
  });
  return result("ceoai.retry-plan","ceoai",[
    plan.some(x=>x.retryable)?pass("safe-retry-candidates","Pronađeni su bezbedni kandidati za ponovni pokušaj.",{count:plan.filter(x=>x.retryable).length}):{...fail("no-safe-retries","Nema bezbednih kandidata za ponovni pokušaj."),severity:"warning"},
    pass("retry-bounded","Broj ponavljanja je ograničen.")
  ],"Napravljen je plan oporavka; ponovni pokušaji nisu izvršeni.",{retry_plan:plan});
}
function verifyOutput(input) {
  if(!plainObject(input.output)) throw new TypeError("output must be an object");
  const required=listField(input.requiredFields,"requiredFields",50).map((x,i)=>textField(x,"requiredFields["+i+"]",100));
  const missing=required.filter(k=>!Object.hasOwn(input.output,k)||input.output[k]===null||input.output[k]==="");
  const checks=[missing.length?{...fail("required-fields-missing","Nedostaju obavezna polja.",{missing}),severity:"warning"}:pass("required-fields-present","Sva obavezna polja postoje.")];
  if(input.output.status==="error"||input.output.error) checks.push(fail("output-signals-error","Izlaz sadrži signal greške."));
  else checks.push(pass("no-explicit-error","Nije pronađeno eksplicitno polje greške."));
  return result("ceoai.output-verification","ceoai",checks,"Izlaz je proverен prema strukturnim kriterijumima.",{valid:missing.length===0&&!input.output.error&&input.output.status!=="error",missing_fields:missing});
}
function headlineVariants(input) {
  const topic=textField(input.topic,"topic",400);
  const audience=textField(input.audience,"audience",250);
  const benefit=textField(input.benefit,"benefit",250);
  const variants=[
    topic+": praktičan vodič za "+audience,
    "Kako "+audience+" mogu da ostvare: "+benefit,
    topic+" — šta treba znati pre nego što počnete",
    "Od problema do rezultata: "+topic,
    benefit+": vodič za "+audience
  ];
  return result("contentcraft.headline-variants","contentcraft",[
    pass("variants-generated","Generisano je pet predloga naslova."),
    pass("no-factual-claims","Naslovi ne uvode statističke tvrdnje."),
    pass("human-review","Naslove treba proveriti pre objave.")
  ],"Predlozi naslova su pripremljeni za urednički izbor.",{variants});
}
function contentQuality(input) {
  const draft=textField(input.draft,"draft",10000);
  const minWords=input.minWords??50;
  if(!Number.isInteger(minWords)||minWords<1||minWords>3000) throw new RangeError("minWords must be 1..3000");
  const words=draft.trim().split(/\s+/).filter(Boolean);
  const links=(draft.match(/https?:\/\//gi)||[]).length;
  const claims=(draft.match(/\b(guaranteed|100%|always|never|dokazano|zagarantovano|uvek|nikada)\b/gi)||[]).length;
  const checks=[
    words.length>=minWords?pass("length-target","Tekst ispunjava minimalnu dužinu.",{word_count:words.length}):{...fail("text-too-short","Tekst je kraći od minimalne dužine.",{word_count:words.length,min_words:minWords}),severity:"warning"},
    links?{...fail("links-need-review","Linkovi zahtevaju proveru izvora.",{count:links}),severity:"warning"}:pass("links-screened","Nema prepoznatih URL linkova."),
    claims?{...fail("absolute-claims-review","Apsolutne tvrdnje zahtevaju proveru dokaza.",{count:claims}),severity:"warning"}:pass("claims-screened","Nisu pronađene poznate apsolutne formulacije.")
  ];
  return result("contentcraft.quality-review","contentcraft",checks,"Tekst je pregledan heuristički, bez izmišljanja činjenica.",{word_count:words.length,link_count:links,claims_for_review:claims,publish_allowed:false});
}
function editorialCalendar(input) {
  const topics=listField(input.topics,"topics",31).map((x,i)=>textField(x,"topics["+i+"]",250));
  if(!topics.length) throw new TypeError("topics must contain at least one topic");
  const start=textField(input.startDate,"startDate",10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||Number.isNaN(Date.parse(start+"T00:00:00Z"))) throw new TypeError("startDate must be YYYY-MM-DD");
  const cadence=input.cadenceDays??7;
  if(!Number.isInteger(cadence)||cadence<1||cadence>31) throw new RangeError("cadenceDays must be 1..31");
  const entries=topics.map((topic,i)=>({date:new Date(Date.parse(start+"T00:00:00Z")+i*cadence*86400000).toISOString().slice(0,10),topic,status:"draft",review_required:true}));
  return result("contentcraft.editorial-calendar","contentcraft",[pass("calendar-bounded","Kalendar je generisan u ograničenom opsegu.",{items:entries.length}),pass("draft-only","Objave su samo nacrti; nisu zakazane niti objavljene.")],"Urednički kalendar je spreman za pregled.",{entries});
}
function redactPrompt(input) {
  const prompt=textField(input.prompt,"prompt",MAX_INPUT_CHARS);
  const redacted=prompt
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[REDACTED_EMAIL]")
    .replace(/\b(?:sk|pk|api|key)[-_][A-Za-z0-9_-]{16,}\b/gi,"[REDACTED_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,"Bearer [REDACTED_TOKEN]");
  const changed=redacted!==prompt;
  return result("aiforce.prompt-redaction","aiforce",[changed?{...fail("sensitive-pattern-redacted","Prepoznati obrasci su uklonjeni iz izlaza."),severity:"warning"}:pass("no-known-patterns","Nisu pronađeni poznati obrasci e-pošte ili tokena.")],"Heuristička redakcija je završena; prompt nije poslat modelu.",{redacted_prompt:redacted,redactions_applied:changed,original_prompt_stored:false});
}
function validateStructuredOutput(input) {
  if(!plainObject(input.output)) throw new TypeError("output must be an object");
  const schema=plainObject(input.schema)?input.schema:{};
  const required=listField(schema.required??[],"schema.required",50).map((x,i)=>textField(x,"schema.required["+i+"]",100));
  const properties=plainObject(schema.properties)?schema.properties:{};
  const errors=[];
  for(const key of required) if(!Object.hasOwn(input.output,key)) errors.push({field:key,reason:"required"});
  for(const [key,type] of Object.entries(properties)) {
    if(!Object.hasOwn(input.output,key)) continue;
    const v=input.output[key];
    const valid=type==="string"?typeof v==="string":type==="number"?typeof v==="number"&&Number.isFinite(v):type==="boolean"?typeof v==="boolean":type==="array"?Array.isArray(v):type==="object"?plainObject(v):false;
    if(!valid) errors.push({field:key,reason:"type",expected:type});
  }
  return result("aiforce.structured-output-validation","aiforce",[errors.length?{...fail("schema-errors","Izlaz ne zadovoljava šemu.",{count:errors.length}),severity:"warning"}:pass("schema-valid","Izlaz zadovoljava prosleđenu šemu.")],"Strukturisani izlaz je validiran lokalno.",{valid:errors.length===0,errors});
}
function keywordMap(input) {
  const keywords=listField(input.keywords,"keywords",100).map((x,i)=>textField(x,"keywords["+i+"]",150));
  const groups=new Map();
  for(const keyword of keywords) {
    const normalized=keyword.toLocaleLowerCase("sr-Latn").replace(/[^\p{L}\p{N}\s-]/gu,"").replace(/\s+/g," ").trim();
    const key=normalized.split(" ").filter(Boolean).sort().join(" ");
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(keyword);
  }
  const clusters=[...groups.entries()].map(([key,items])=>({cluster_key:key,keywords:items,duplicate_or_variant_count:items.length}));
  return result("rankgeo.keyword-map","rankgeo",[pass("keywords-normalized","Ključne reči su normalizovane.",{count:keywords.length}),pass("clusters-created","Klasteri su grupisani po istim tokenima.")],"Napravljena je početna mapa sličnih ključnih reči; semantička sličnost nije procenjena.",{clusters});
}
function localListingAudit(input) {
  const listing=input.listing;
  if(!plainObject(listing)) throw new TypeError("listing must be an object");
  const fields=["name","address","phone","website","primaryCategory","openingHours"];
  const missing=fields.filter(k=>typeof listing[k]!=="string"||!listing[k].trim());
  const checks=fields.map(k=>missing.includes(k)?{...fail("missing-"+k,"Nedostaje polje: "+k),severity:"warning"}:pass("present-"+k,"Polje je navedeno: "+k));
  checks.push(listing.verifiedByOwner===true?pass("owner-verification","Vlasnička provera je označena."): {...fail("owner-verification-needed","Vlasnička provera nije potvrđena."),severity:"warning"});
  return result("rankgeo.local-listing-audit","rankgeo",checks,"Listing je proveren prema osnovnim poljima; podaci nisu objavljeni niti nezavisno potvrđeni.",{missing_fields:missing,ready_for_human_review:missing.length===0&&listing.verifiedByOwner===true});
}
function validateJsonLd(input) {
  const raw=textField(input.jsonLd,"jsonLd",10000);
  let data;
  try { data=JSON.parse(raw); } catch { return result("rankgeo.jsonld-validation","rankgeo",[fail("invalid-json","JSON-LD nije validan JSON.")],"JSON-LD validacija nije prošla.",{valid:false}); }
  const errors=[];
  const nodes=Array.isArray(data)?data:[data];
  if(!nodes.length) errors.push("empty-document");
  for(const [i,node] of nodes.entries()) {
    if(!plainObject(node)) { errors.push("node-"+i+"-not-object"); continue; }
    if(!node["@context"]) errors.push("node-"+i+"-missing-context");
    if(!node["@type"]) errors.push("node-"+i+"-missing-type");
  }
  return result("rankgeo.jsonld-validation","rankgeo",[errors.length?{...fail("jsonld-structure","JSON-LD zahteva ispravke.",{errors}),severity:"warning"}:pass("jsonld-structure","Osnovna JSON-LD struktura je prisutna.")],"JSON-LD je parsiran i osnovna struktura proverena; nije potvrđena prema eksternom pretraživaču.",{valid:errors.length===0,errors});
}
function permissionReview(input) {
  const permissions=listField(input.permissions,"permissions",100);
  const reviewed=permissions.map((p,i)=>{
    if(!plainObject(p)) throw new TypeError("permissions["+i+"] must be an object");
    const name=textField(p.name,"permissions["+i+"].name",100);
    const scope=textField(p.scope,"permissions["+i+"].scope",100);
    const required=p.required===true;
    const broad=p.scope==="admin"||p.scope==="all"||p.wildcard===true;
    return {name,scope,required,broad,decision:broad?"remove-or-narrow":required?"retain-if-justified":"remove-if-unused"};
  });
  return result("safe-automaton.permission-review","safe-automaton",[reviewed.some(p=>p.broad)?{...fail("broad-permission","Pronađene su široke dozvole koje treba suziti."),severity:"warning"}:pass("least-privilege","Nisu pronađene očigledno široke dozvole.")],"Pripremljen je pregled najmanjih privilegija; dozvole nisu menjane.",{permissions:reviewed,mutations_performed:false});
}
function incidentTriage(input) {
  const description=textField(input.description,"description",3000);
  const signals=listField(input.signals??[],"signals",30).map((x,i)=>textField(x,"signals["+i+"]",200).toLowerCase());
  const text=(description+" "+signals.join(" ")).toLowerCase();
  const severity=/data loss|secret leak|credential leak|curenje tajne|gubitak podataka/.test(text)?"critical":/unauthorized|unauthorized access|neovlašćen|breach|kompromit/.test(text)?"high":/error|failure|timeout|greška|pad/.test(text)?"medium":"low";
  const actions=severity==="critical"?["zaustavi pogođenu funkciju preko odobrenog incident procesa","rotiraj kompromitovane tajne preko vlasnika","sačuvaj redigovane dokaze","obavesti odgovorne osobe"]:severity==="high"?["ograniči pogođeni pristup","proveri audit logove","eskaliraj vlasniku sistema"]:severity==="medium"?["sačuvaj redigovanu grešku","proveri health i poslednje izmene","ponovi test u izolaciji"]:["prikupi dodatne informacije","zabeleži očekivano i stvarno ponašanje"];
  return result("safe-automaton.incident-triage","safe-automaton",[severity==="critical"||severity==="high"?{...fail("incident-escalation","Incident zahteva hitnu ljudsku eskalaciju.",{severity}),severity:"warning"}:pass("severity-assessed","Početna ozbiljnost je procenjena.",{severity})],"Incident je trijažiran; nijedna promena sistema nije izvršena.",{severity,recommended_actions:actions,description_stored:false});
}
function rollbackPlan(input) {
  const current=textField(input.currentVersion,"currentVersion",100);
  const previous=textField(input.previousKnownGoodVersion,"previousKnownGoodVersion",100);
  const healthCheck=textField(input.healthCheck,"healthCheck",500);
  const checks=[
    current!==previous?pass("versions-distinct","Trenutna i prethodna verzija se razlikuju."):fail("same-version","Rollback cilj ne sme biti ista verzija."),
    input.backupVerified===true?pass("backup-verified","Rezervna kopija je označena kao proverena."):{...fail("backup-unverified","Rezervna kopija nije potvrđena."),severity:"warning"},
    input.ownerApproval===true?pass("approval-present","Odobrenje vlasnika je navedeno."):{...fail("approval-required","Rollback nije izvršen bez odobrenja vlasnika."),severity:"warning"}
  ];
  return result("safe-automaton.rollback-plan","safe-automaton",checks,"Plan povratka je pripremljen, ali nije izvršen.",{current_version:current,target_version:previous,post_rollback_health_check:healthCheck,execution_started:false,requires_owner_approval:true});
}


function providerFallbackPlan(input) {
  const providers=listField(input.providers,"providers",50).map((p,i)=>{
    if(!plainObject(p)) throw new TypeError("providers["+i+"] must be an object");
    const id=textField(p.id,"providers["+i+"].id",100);
    return {id,healthy:p.healthy===true,freeQuotaConfirmed:p.freeQuotaConfirmed===true,priority:Number.isFinite(p.priority)?p.priority:100};
  });
  const eligible=providers.filter(p=>p.healthy&&p.freeQuotaConfirmed).sort((a,b)=>a.priority-b.priority);
  return result("ceoai.provider-fallback-plan","ceoai",[eligible.length?pass("eligible-provider-found","Pronađen je kandidat za besplatni fallback.",{count:eligible.length}):{...fail("no-free-fallback","Nema zdravog provajdera sa potvrđenom besplatnom kvotom."),severity:"warning"}],"Napravljen je fallback redosled bez pozivanja provajdera.",{provider_order:eligible.map(p=>p.id),network_calls:0});
}
function quotaEventReview(input) {
  const event=input.event;
  if(!plainObject(event)) throw new TypeError("event must be an object");
  const used=event.used, limit=event.limit;
  const valid=Number.isFinite(used)&&used>=0&&Number.isFinite(limit)&&limit>0;
  const ratio=valid?used/limit:null;
  const state=!valid?"unknown":ratio>=1?"exhausted":ratio>=0.8?"near-limit":"within-limit";
  return result("ceoai.quota-event-review","ceoai",[valid?pass("quota-values-valid","Vrednosti kvote su numerički validne."):{...fail("quota-values-invalid","Korišćenje i limit kvote nisu validni."),severity:"warning"},state==="exhausted"?{...fail("quota-exhausted","Kvote je dostignuta; poziv treba blokirati."),severity:"warning"}:pass("quota-state","Stanje kvote je klasifikovano.",{state})],"Kvote su procenjene iz prosleđenih metrika; API nije pozvan.",{state,usage_ratio:ratio,allow_new_call:valid&&ratio<1});
}
function auditRedaction(input) {
  if(!plainObject(input.event)) throw new TypeError("event must be an object");
  const sensitive=/token|secret|password|api.?key|authorization|cookie/i;
  const safe={};
  for(const [key,value] of Object.entries(input.event)) safe[key]=sensitive.test(key)?"[REDACTED]":typeof value==="string"?value.slice(0,300):value;
  return result("ceoai.audit-redaction","ceoai",[pass("sensitive-keys-redacted","Polja koja liče na tajne su redigovana.")],"Audit događaj je očišćen za bezbedniji pregled.",{event:safe,raw_event_stored:false});
}
function responseContract(input) {
  const response=input.response;
  if(!plainObject(response)) throw new TypeError("response must be an object");
  const required=["status","content"];
  const missing=required.filter(k=>!Object.hasOwn(response,k)||response[k]===null||response[k]==="");
  const checks=[missing.length?{...fail("response-contract-missing","Nedostaju obavezna polja.",{missing}),severity:"warning"}:pass("response-contract-valid","Obavezna polja postoje."),typeof response.content==="string"?pass("content-type","Sadržaj je tekst.") : fail("content-type-invalid","Sadržaj odgovora mora biti tekst.")];
  return result("ceoai.response-contract","ceoai",checks,"Odgovor je proveren prema osnovnom ugovoru.",{valid:missing.length===0&&typeof response.content==="string"});
}
function providerConfigReview(input) {
  const configs=listField(input.providers,"providers",50);
  const rows=configs.map((p,i)=>{
    if(!plainObject(p)) throw new TypeError("providers["+i+"] must be an object");
    const id=textField(p.id,"providers["+i+"].id",100);
    let secure=false; try {secure=new URL(p.endpoint).protocol==="https:";} catch {}
    const free=p.freeQuotaConfirmed===true;
    return {id,https_endpoint:secure,free_quota_confirmed:free,eligible:secure&&free&&p.enabled===true,issues:[...(!secure?["https-required"]:[]),...(!free?["free-quota-unconfirmed"]:[]),...(p.enabled!==true?["disabled"]:[])]};
  });
  return result("ceoai.provider-config-review","ceoai",[rows.some(x=>x.eligible)?pass("provider-config-eligible","Postoji provajder sa HTTPS endpointom i potvrđenom besplatnom kvotom."):{...fail("no-eligible-provider","Nijedna konfiguracija nije potvrđena kao podobna."),severity:"warning"}],"Konfiguracije su proverene bez slanja zahteva.",{providers:rows});
}
function metaDescription(input) {
  const summary=textField(input.summary,"summary",2000);
  const max=input.maxChars??155;
  if(!Number.isInteger(max)||max<50||max>320) throw new RangeError("maxChars must be 50..320");
  const normalized=summary.replace(/\s+/g," ").trim();
  const description=normalized.length<=max?normalized:normalized.slice(0,max-1).replace(/\s+\S*$/,"").trimEnd()+"…";
  return result("contentcraft.meta-description","contentcraft",[pass("description-bounded","Meta opis je ograničen na traženu dužinu.",{characters:description.length,max}),description.length>=50?pass("description-length","Opis ima najmanje 50 znakova."):{...fail("description-short","Opis je kraći od 50 znakova."),severity:"warning"}],"Meta opis je pripremljen iz datog sažetka, bez objavljivanja.",{description,characters:description.length});
}
function contentOutline(input) {
  const topic=textField(input.topic,"topic",400);
  const audience=textField(input.audience,"audience",250);
  const sections=input.sections??5;
  if(!Number.isInteger(sections)||sections<3||sections>10) throw new RangeError("sections must be 3..10");
  const headings=["Uvod: zašto je "+topic+" važan", "Najčešći problemi za "+audience];
  for(let i=1;i<=sections-2;i++) headings.push("Korak "+i+": praktičan pristup");
  headings.push("Zaključak i sledeći koraci");
  return result("contentcraft.content-outline","contentcraft",[pass("outline-bounded","Plan ima ograničen broj odeljaka.",{count:headings.length}),pass("outline-review","Naslove treba urednički prilagoditi temi.")],"Napravljena je struktura sadržaja.",{headings});
}
function ctaGenerator(input) {
  const goal=textField(input.goal,"goal",250);
  const audience=textField(input.audience,"audience",250);
  const ctas=[ "Saznajte više o tome kako "+goal+".", "Proverite mogućnosti za "+audience+".", "Napravite sledeći korak ka cilju: "+goal+"." ];
  return result("contentcraft.cta-generator","contentcraft",[pass("cta-options","Generisane su tri nenametljive opcije poziva na akciju."),pass("no-action-taken","Pozivi na akciju nisu aktivirani.")],"CTA predlozi su spremni za izbor.",{ctas});
}
function socialRepurpose(input) {
  const message=textField(input.message,"message",3000);
  const channels=listField(input.channels??["LinkedIn","Facebook","Instagram"],"channels",8).map((x,i)=>textField(x,"channels["+i+"]",50));
  const variants=channels.map(channel=>({channel,text:channel.toLowerCase().includes("instagram")?message.slice(0,220):channel.toLowerCase().includes("linkedin")?message.slice(0,1200):message.slice(0,600),review_required:true}));
  return result("contentcraft.social-repurpose","contentcraft",[pass("channel-variants","Pripremljene su varijante po kanalu.",{count:variants.length}),pass("publication-disabled","Ništa nije objavljeno.")],"Sadržaj je prilagođen ograničenjima dužine kanala.",{variants});
}
function brandVoiceReview(input) {
  const draft=textField(input.draft,"draft",8000);
  const forbidden=listField(input.forbiddenPhrases??[],"forbiddenPhrases",40).map((x,i)=>textField(x,"forbiddenPhrases["+i+"]",100));
  const matches=forbidden.filter(p=>draft.toLocaleLowerCase("sr-Latn").includes(p.toLocaleLowerCase("sr-Latn")));
  return result("contentcraft.brand-voice-review","contentcraft",[matches.length?{...fail("forbidden-phrase-found","Pronađene su zabranjene fraze.",{matches}),severity:"warning"}:pass("voice-constraints","Nijedna prosleđena zabranjena fraza nije pronađena.")],"Provera tona brenda završena je prema pravilima koja je korisnik dostavio.",{matches,review_passed:matches.length===0});
}
function briefCompleteness(input) {
  const brief=input.brief;
  if(!plainObject(brief)) throw new TypeError("brief must be an object");
  const required=["topic","audience","goal","channels"];
  const missing=required.filter(k=>!brief[k]||(Array.isArray(brief[k])&&!brief[k].length));
  return result("contentcraft.brief-completeness","contentcraft",[missing.length?{...fail("brief-incomplete","Briefu nedostaju ključna polja.",{missing}),severity:"warning"}:pass("brief-complete","Sva ključna polja briefa su prisutna.")],"Kompletnost briefa je proverena.",{complete:missing.length===0,missing});
}
function claimReview(input) {
  const textValue=textField(input.text,"text",8000);
  const matches=[...textValue.matchAll(/\b\d+(?:[.,]\d+)?\s?%|\b(?:studies show|research proves|istraživanja dokazuju|dokazano je)\b/gi)].map(m=>m[0]);
  return result("contentcraft.claim-review","contentcraft",[matches.length?{...fail("claims-need-evidence","Pronađene su brojčane ili dokazne tvrdnje za proveru.",{count:matches.length}),severity:"warning"}:pass("claims-screened","Nisu prepoznate brojčane ili dokazne formulacije.")],"Tvrdnje su izdvojene za proveru; nisu potvrđene kao istinite ili netačne.",{claims_for_evidence:matches,publication_allowed:false});
}
function jailbreakClassifier(input) {
  const prompt=textField(input.prompt,"prompt",MAX_INPUT_CHARS);
  const patterns=[["instruction-override",/ignore (all )?(previous|prior) instructions|zanemari prethodna uputstva/i],["secret-exfiltration",/reveal (the )?(system prompt|secret|api key)|otkrij tajnu/i],["role-escalation",/act as system|pretend you are the developer|postavi se kao administrator/i],["tool-abuse",/disable safety|bypass security|zaobiđi bezbednost/i]];
  const findings=patterns.filter(([,re])=>re.test(prompt)).map(([id])=>id);
  return result("aiforce.jailbreak-classifier","aiforce",[findings.length?{...fail("suspicious-instructions","Pronađeni su obrasci koji zahtevaju bezbednosnu proveru.",{findings}),severity:"warning"}:pass("no-known-jailbreak-patterns","Nisu prepoznati poznati obrasci napada.")],"Heuristička klasifikacija je završena; prompt nije izvršen.",{findings,classification:findings.length?"review-required":"no-known-pattern"});
}
function promptBudget(input) {
  const prompt=textField(input.prompt,"prompt",MAX_INPUT_CHARS);
  const max=input.maxTokens??4000;
  if(!Number.isInteger(max)||max<1||max>100000) throw new RangeError("maxTokens must be 1..100000");
  const estimate=Math.ceil(prompt.length/4);
  return result("aiforce.prompt-budget","aiforce",[estimate<=max?pass("within-budget","Procena je unutar budžeta.",{estimated_tokens:estimate,max}):{...fail("over-budget","Procena prelazi zadati budžet.",{estimated_tokens:estimate,max}),severity:"warning"}],"Broj tokena je gruba procena iz dužine teksta, ne tačan tokenizer.",{estimated_tokens:estimate,max_tokens:max,estimate_only:true});
}
function piiRisk(input) {
  const textValue=textField(input.text,"text",8000);
  const findings=[];
  if(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(textValue)) findings.push("email-like");
  if(/\b\+?\d[\d\s().-]{7,}\d\b/.test(textValue)) findings.push("phone-like");
  if(/\b\d{13,19}\b/.test(textValue)) findings.push("long-numeric-identifier");
  return result("aiforce.pii-risk","aiforce",[findings.length?{...fail("possible-pii","Pronađeni su mogući lični podaci.",{findings}),severity:"warning"}:pass("no-common-pii-patterns","Nisu pronađeni uobičajeni obrasci ličnih podataka.")],"Procena privatnosti je heuristička i nije garancija odsustva ličnih podataka.",{findings,raw_text_stored:false});
}
function toolAllowlist(input) {
  const requested=listField(input.requestedTools,"requestedTools",50).map((x,i)=>textField(x,"requestedTools["+i+"]",100));
  const allowed=listField(input.allowedTools??[],"allowedTools",50).map((x,i)=>textField(x,"allowedTools["+i+"]",100));
  const denied=requested.filter(x=>!allowed.includes(x));
  return result("aiforce.tool-allowlist","aiforce",[denied.length?{...fail("tools-not-allowlisted","Zatraženi alati nisu na listi dozvoljenih.",{denied}),severity:"warning"}:pass("tools-allowlisted","Svi zatraženi alati su na listi dozvoljenih.")],"Dozvole alata su proverene; nijedan alat nije pozvan.",{allowed:requested.filter(x=>allowed.includes(x)),denied,execution_started:false});
}
function outputSafetyReview(input) {
  const textValue=textField(input.output,"output",8000);
  const flags=[];
  if(/\bguaranteed cure|guaranteed profit|zagarantovan lek|sigurna zarada\b/i.test(textValue)) flags.push("unsupported-guarantee");
  if(/\b(password|api key|secret token)\s*[:=]\s*\S+/i.test(textValue)) flags.push("possible-secret-disclosure");
  if(/\b(send now|publish immediately|buy now|delete all)\b/i.test(textValue)) flags.push("external-action-language");
  return result("aiforce.output-safety-review","aiforce",[flags.length?{...fail("output-review-needed","Izlaz sadrži rizične obrasce za ljudsku proveru.",{flags}),severity:"warning"}:pass("no-known-output-flags","Nisu prepoznati poznati rizični obrasci.")],"Izlaz je proveren heuristikama, bez slanja ili izvršavanja.",{flags,approved_for_release:flags.length===0});
}
function promptTemplateReview(input) {
  const template=textField(input.template,"template",5000);
  const required=listField(input.requiredPlaceholders??[],"requiredPlaceholders",30).map((x,i)=>textField(x,"requiredPlaceholders["+i+"]",100));
  const missing=required.filter(p=>!template.includes("{{"+p+"}}"));
  const malformed=(template.match(/\{\{/g)||[]).length!==(template.match(/\}\}/g)||[]).length;
  const issues=[...missing.map(p=>"missing:"+p),...(malformed?["unbalanced-placeholders"]:[])];
  return result("aiforce.prompt-template-review","aiforce",[issues.length?{...fail("template-invalid","Šablon ima nedostajuće ili neispravne placeholder-e.",{issues}),severity:"warning"}:pass("template-valid","Obavezni placeholder-i su prisutni.")],"Šablon je validiran bez njegovog izvršavanja.",{valid:issues.length===0,issues});
}
function titleMetaLength(input) {
  const title=textField(input.title,"title",500);
  const description=textField(input.description,"description",1000);
  const checks=[
    title.length>=30&&title.length<=60?pass("title-length","Naslov je u preporučenom rasponu.",{length:title.length}):{...fail("title-length-review","Naslov je van raspona 30–60 znakova.",{length:title.length}),severity:"warning"},
    description.length>=120&&description.length<=160?pass("description-length","Meta opis je u preporučenom rasponu.",{length:description.length}):{...fail("description-length-review","Meta opis je van raspona 120–160 znakova.",{length:description.length}),severity:"warning"}
  ];
  return result("rankgeo.title-meta-length","rankgeo",checks,"Dužine SEO elemenata su proverene; rasponi su smernice, ne garancija rangiranja.",{title_length:title.length,description_length:description.length});
}
function sitemapUrlReview(input) {
  const urls=listField(input.urls,"urls",500).map((x,i)=>textField(x,"urls["+i+"]",2048));
  const rows=urls.map(url=>{try{const u=new URL(url);return {url,valid:["http:","https:"].includes(u.protocol)&&!u.username&&!u.password,reason:["http:","https:"].includes(u.protocol)?"ok":"scheme-not-allowed"};}catch{return {url,valid:false,reason:"invalid-url"};}});
  return result("rankgeo.sitemap-url-review","rankgeo",[rows.every(x=>x.valid)?pass("sitemap-urls-valid","Svi URL-ovi su apsolutni HTTP(S) URL-ovi."):{...fail("sitemap-invalid-urls","Sitemap lista sadrži nevalidne URL-ove.",{count:rows.filter(x=>!x.valid).length}),severity:"warning"}],"URL-ovi su provereni lokalno; nijedan URL nije posećen.",{urls:rows});
}
function robotsReview(input) {
  const directives=listField(input.directives,"directives",100).map((x,i)=>textField(x,"directives["+i+"]",300));
  const conflicts=directives.filter(x=>/^disallow:\s*\/$/i.test(x.trim()));
  const sitemap=directives.filter(x=>/^sitemap:\s*https?:\/\//i.test(x.trim()));
  return result("rankgeo.robots-review","rankgeo",[conflicts.length?{...fail("sitewide-disallow","Pronađena je direktiva koja može blokirati ceo sajt.",{count:conflicts.length}),severity:"warning"}:pass("no-sitewide-disallow","Nije pronađena globalna Disallow: / direktiva."),sitemap.length?pass("sitemap-directive","Sitemap direktiva je prisutna.",{count:sitemap.length}):{...fail("sitemap-unlisted","Sitemap direktiva nije navedena."),severity:"warning"}],"Robots direktive su pregledane iz dostavljenog teksta; nisu preuzete sa sajta.",{sitewide_disallow_found:conflicts.length>0,sitemap_directives:sitemap});
}
function internalLinkMap(input) {
  const pages=listField(input.pages,"pages",200);
  const ids=new Set();
  for(const [i,p] of pages.entries()){if(!plainObject(p))throw new TypeError("pages["+i+"] must be an object");ids.add(textField(p.url,"pages["+i+"].url",2048));}
  const edges=[];
  for(const [i,p] of pages.entries()) for(const target of listField(p.links??[],"pages["+i+"].links",100)) edges.push({from:p.url,to:textField(target,"link target",2048),internal:ids.has(target)});
  const orphaned=[...ids].filter(url=>!edges.some(e=>e.to===url));
  return result("rankgeo.internal-link-map","rankgeo",[pass("link-graph-created","Graf linkova je izgrađen iz dostavljenih podataka.",{edges:edges.length}),orphaned.length?{...fail("orphan-candidates","Stranice bez ulaznih linkova zahtevaju proveru.",{count:orphaned.length}),severity:"warning"}:pass("no-orphan-candidates","Svaka stranica ima bar jedan ulazni link.")],"Interni linkovi su analizirani iz prosleđenih podataka.",{edges,orphan_candidates:orphaned});
}
function redirectPolicy(input) {
  const hops=listField(input.chain,"chain",20).map((x,i)=>textField(x,"chain["+i+"]",2048));
  const normalized=hops.map(x=>{try{return new URL(x).href;}catch{return null;}});
  const duplicates=new Set(normalized.filter(Boolean)).size!==normalized.filter(Boolean).length;
  const valid=normalized.every(Boolean);
  const checks=[valid?pass("redirect-urls-valid","URL-ovi u lancu su validni.") : fail("redirect-url-invalid","Lanac sadrži nevalidan URL."),hops.length<=5?pass("redirect-depth","Dužina lanca je do pet koraka.",{hops:hops.length}):{...fail("redirect-chain-long","Lanac ima više od pet koraka.",{hops:hops.length}),severity:"warning"},duplicates?{...fail("redirect-loop","Moguć je redirect loop."),severity:"warning"}:pass("no-redirect-loop","Nema duplikata URL-ova u lancu.")];
  return result("rankgeo.redirect-policy","rankgeo",checks,"Lanac preusmerenja je statički proveren; nijedan URL nije posećen.",{normalized_chain:normalized,loop_suspected:duplicates});
}
function duplicatePageGroups(input) {
  const pages=listField(input.pages,"pages",300);
  const groups=new Map();
  for(const [i,p] of pages.entries()){
    if(!plainObject(p))throw new TypeError("pages["+i+"] must be an object");
    const url=textField(p.url,"pages["+i+"].url",2048);
    const title=textField(p.title,"pages["+i+"].title",500).toLocaleLowerCase("sr-Latn").replace(/\s+/g," ").trim();
    if(!groups.has(title))groups.set(title,[]);
    groups.get(title).push(url);
  }
  const duplicates=[...groups.entries()].filter(([,urls])=>urls.length>1).map(([title,urls])=>({title,urls}));
  return result("rankgeo.duplicate-page-groups","rankgeo",[duplicates.length?{...fail("duplicate-title-groups","Pronađene su grupe stranica sa istim naslovom.",{count:duplicates.length}),severity:"warning"}:pass("no-duplicate-titles","Nema identičnih naslova u dostavljenom skupu.")],"Duplikati su grupisani po naslovu; nije rađena web pretraga.",{duplicate_groups:duplicates});
}
function secretConfigReview(input) {
  const entries=listField(input.entries,"entries",200);
  const findings=[];
  for(const [i,e] of entries.entries()){
    if(!plainObject(e))throw new TypeError("entries["+i+"] must be an object");
    const name=textField(e.name,"entries["+i+"].name",200);
    if(/secret|token|password|api.?key/i.test(name)&&e.valuePresent===true&&e.storedAsSecret!==true) findings.push({name,issue:"secret-like-value-not-marked-secret"});
    if(e.committedToRepo===true&&/secret|token|password|api.?key/i.test(name)) findings.push({name,issue:"possible-secret-in-repository"});
  }
  return result("safe-automaton.secret-config-review","safe-automaton",[findings.length?{...fail("secret-config-review-needed","Konfiguracija sadrži potencijalno nesigurno rukovanje tajnama.",{count:findings.length}),severity:"warning"}:pass("secret-config-screen","Nisu prijavljeni očigledni problemi sa tajnama.")],"Provereni su metapodaci konfiguracije; vrednosti tajni nisu čitane.",{findings,secret_values_read:false});
}
function resourceBudgetReview(input) {
  const job=input.job;
  if(!plainObject(job))throw new TypeError("job must be an object");
  const checks=[
    Number.isInteger(job.timeoutMs)&&job.timeoutMs>=100&&job.timeoutMs<=30000?pass("timeout-bounded","Timeout je ograničen."):fail("timeout-invalid","Timeout mora biti 100–30000 ms."),
    Number.isInteger(job.memoryMb)&&job.memoryMb>=16&&job.memoryMb<=512?pass("memory-bounded","Memorija je ograničena."):fail("memory-invalid","Memorija mora biti 16–512 MB."),
    Number.isInteger(job.maxOutputBytes)&&job.maxOutputBytes>=1024&&job.maxOutputBytes<=1048576?pass("output-bounded","Izlaz je ograničen."):fail("output-invalid","Maksimalni izlaz mora biti 1 KB–1 MB.")
  ];
  return result("safe-automaton.resource-budget-review","safe-automaton",checks,"Resursni budžet je proverен; posao nije pokrenut.",{eligible:checks.every(x=>x.ok),execution_started:false});
}
function jobInputValidation(input) {
  const fields=input.fields;
  if(!plainObject(fields))throw new TypeError("fields must be an object");
  const schema=plainObject(input.schema)?input.schema:{};
  const required=listField(schema.required??[],"schema.required",50).map((x,i)=>textField(x,"schema.required["+i+"]",100));
  const missing=required.filter(k=>!Object.hasOwn(fields,k)||fields[k]===null||fields[k]==="");
  const unexpected=Object.keys(fields).filter(k=>schema.additionalProperties===false&&!Object.hasOwn(schema.properties??{},k));
  const issues=[...missing.map(k=>"missing:"+k),...unexpected.map(k=>"unexpected:"+k)];
  return result("safe-automaton.job-input-validation","safe-automaton",[issues.length?{...fail("job-input-invalid","Ulaz posla ne zadovoljava šemu.",{issues}),severity:"warning"}:pass("job-input-valid","Ulaz zadovoljava osnovna pravila šeme.")],"Ulaz je validiran bez pokretanja posla.",{valid:issues.length===0,issues});
}
function artifactProvenance(input) {
  const artifact=input.artifact;
  if(!plainObject(artifact))throw new TypeError("artifact must be an object");
  const checks=[
    typeof artifact.name==="string"&&artifact.name.trim()?pass("artifact-name","Naziv artefakta postoji."):fail("artifact-name-missing","Nedostaje naziv artefakta."),
    typeof artifact.sha256==="string"&&/^[a-f0-9]{64}$/i.test(artifact.sha256)?pass("sha256-format","SHA-256 format je validan."):fail("sha256-invalid","Nedostaje validan SHA-256 heš."),
    typeof artifact.source==="string"&&artifact.source.trim()?pass("artifact-source","Izvor artefakta je naveden."):{...fail("artifact-source-missing","Izvor artefakta nije naveden."),severity:"warning"},
    artifact.signatureVerified===true?pass("signature-verified","Potpis je označen kao proveren."):{...fail("signature-unverified","Potpis nije potvrđen."),severity:"warning"}
  ];
  return result("safe-automaton.artifact-provenance","safe-automaton",checks,"Poreklo artefakta je provereno prema dostavljenim metapodacima; heš nije sam izračunat.",{provenance_complete:checks.every(x=>x.ok),signature_independently_verified:false});
}
function externalApprovalCheck(input) {
  const action=textField(input.action,"action",500);
  const approved=input.ownerApproval===true&&typeof input.approvalReference==="string"&&input.approvalReference.trim().length>0;
  const highImpact=input.highImpact===true;
  const allowed=approved&&(!highImpact||input.secondReviewerApproval===true);
  return result("safe-automaton.external-approval-check","safe-automaton",[allowed?pass("approval-complete","Odobrenje i referenca su prisutni."):{...fail("approval-missing","Spoljašnja radnja nije odobrena; potreban je vlasnik i referenca."),severity:"warning"},highImpact&&!input.secondReviewerApproval?{...fail("second-review-required","Radnja visokog uticaja zahteva drugu proveru."),severity:"warning"}:pass("impact-review","Dodatna provera nije potrebna ili je navedena.")],"Odobrenje je provereno; radnja nije izvršena.",{action,approved_for_manual_dispatch:allowed,action_executed:false});
}
function securityHeaderReview(input) {
  const headers=plainObject(input.headers)?input.headers:{};
  const normalized=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),String(v)]));
  const rules=[
    ["content-security-policy","content-security-policy"],
    ["x-content-type-options","x-content-type-options"],
    ["referrer-policy","referrer-policy"],
    ["strict-transport-security","strict-transport-security"]
  ];
  const checks=rules.map(([key,code])=>normalized[key]?pass(code,"Bezbednosno zaglavlje je prisutno: "+key):{...fail(code+"-missing","Nedostaje zaglavlje: "+key),severity:"warning"});
  return result("safe-automaton.security-header-review","safe-automaton",checks,"HTTP zaglavlja su proverena iz dostavljenog skupa; sajt nije posećen.",{missing_headers:rules.filter(([key])=>!normalized[key]).map(([key])=>key)});
}

const WORKFLOWS = Object.freeze({
  "contentcraft.content-brief": { app: "contentcraft", run: contentBrief },
  "rankgeo.seo-checklist": { app: "rankgeo", run: seoChecklist },
  "ceoai.provider-health": { app: "ceoai", run: providerHealth },
  "rankgeo.listing-validation": { app: "rankgeo", run: validateListings },
  "safe-automaton.job-policy-review": { app: "safe-automaton", run: safeJobReview },
  "aiforce.prompt-safety-review": { app: "aiforce", run: aiForcePromptReview },
  "ceoai.task-intake": { app: "ceoai", run: taskIntake },
  "ceoai.retry-plan": { app: "ceoai", run: retryPlan },
  "ceoai.output-verification": { app: "ceoai", run: verifyOutput },
  "contentcraft.headline-variants": { app: "contentcraft", run: headlineVariants },
  "contentcraft.quality-review": { app: "contentcraft", run: contentQuality },
  "contentcraft.editorial-calendar": { app: "contentcraft", run: editorialCalendar },
  "aiforce.prompt-redaction": { app: "aiforce", run: redactPrompt },
  "aiforce.structured-output-validation": { app: "aiforce", run: validateStructuredOutput },
  "rankgeo.keyword-map": { app: "rankgeo", run: keywordMap },
  "rankgeo.local-listing-audit": { app: "rankgeo", run: localListingAudit },
  "rankgeo.jsonld-validation": { app: "rankgeo", run: validateJsonLd },
  "safe-automaton.permission-review": { app: "safe-automaton", run: permissionReview },
  "safe-automaton.incident-triage": { app: "safe-automaton", run: incidentTriage },
  "safe-automaton.rollback-plan": { app: "safe-automaton", run: rollbackPlan },
  "ceoai.provider-fallback-plan": { app: "ceoai", run: providerFallbackPlan },
  "ceoai.quota-event-review": { app: "ceoai", run: quotaEventReview },
  "ceoai.audit-redaction": { app: "ceoai", run: auditRedaction },
  "ceoai.response-contract": { app: "ceoai", run: responseContract },
  "ceoai.provider-config-review": { app: "ceoai", run: providerConfigReview },
  "contentcraft.meta-description": { app: "contentcraft", run: metaDescription },
  "contentcraft.content-outline": { app: "contentcraft", run: contentOutline },
  "contentcraft.cta-generator": { app: "contentcraft", run: ctaGenerator },
  "contentcraft.social-repurpose": { app: "contentcraft", run: socialRepurpose },
  "contentcraft.brand-voice-review": { app: "contentcraft", run: brandVoiceReview },
  "contentcraft.brief-completeness": { app: "contentcraft", run: briefCompleteness },
  "contentcraft.claim-review": { app: "contentcraft", run: claimReview },
  "aiforce.jailbreak-classifier": { app: "aiforce", run: jailbreakClassifier },
  "aiforce.prompt-budget": { app: "aiforce", run: promptBudget },
  "aiforce.pii-risk": { app: "aiforce", run: piiRisk },
  "aiforce.tool-allowlist": { app: "aiforce", run: toolAllowlist },
  "aiforce.output-safety-review": { app: "aiforce", run: outputSafetyReview },
  "aiforce.prompt-template-review": { app: "aiforce", run: promptTemplateReview },
  "rankgeo.title-meta-length": { app: "rankgeo", run: titleMetaLength },
  "rankgeo.sitemap-url-review": { app: "rankgeo", run: sitemapUrlReview },
  "rankgeo.robots-review": { app: "rankgeo", run: robotsReview },
  "rankgeo.internal-link-map": { app: "rankgeo", run: internalLinkMap },
  "rankgeo.redirect-policy": { app: "rankgeo", run: redirectPolicy },
  "rankgeo.duplicate-page-groups": { app: "rankgeo", run: duplicatePageGroups },
  "safe-automaton.secret-config-review": { app: "safe-automaton", run: secretConfigReview },
  "safe-automaton.resource-budget-review": { app: "safe-automaton", run: resourceBudgetReview },
  "safe-automaton.job-input-validation": { app: "safe-automaton", run: jobInputValidation },
  "safe-automaton.artifact-provenance": { app: "safe-automaton", run: artifactProvenance },
  "safe-automaton.external-approval-check": { app: "safe-automaton", run: externalApprovalCheck },
  "safe-automaton.security-header-review": { app: "safe-automaton", run: securityHeaderReview },
});


const APP_GROUPS = Object.freeze({
  ceoai: "ceoai",
  contentcraft: "contentcraft",
  aiforce: "aiforce",
  rankgeo: "rankgeo-safe-automaton",
  "safe-automaton": "rankgeo-safe-automaton",
});
const APP_LABELS = Object.freeze({
  ceoai: "CEOAI",
  contentcraft: "ContentCraft",
  aiforce: "AI Force",
  "rankgeo-safe-automaton": "RankGeo / Safe Automaton",
});
export function listAgentApplicationGroups() {
  const workflows = Object.entries(WORKFLOWS);
  return Object.entries(APP_LABELS).map(([id, label]) => ({
    id, label,
    workflow_count: workflows.filter(([, value]) => APP_GROUPS[value.app] === id).length,
    runtime_mode: "local-deterministic",
    ai_assisted_runtime_available: true,
    autonomous_tool_execution: false,
    external_actions: false,
  }));
}

export function listExecutableWorkflows() {
  return Object.entries(WORKFLOWS).map(([id, value]) => ({
    id, app: value.app, application_group: APP_GROUPS[value.app] || value.app, execution_mode: "local-deterministic",
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
