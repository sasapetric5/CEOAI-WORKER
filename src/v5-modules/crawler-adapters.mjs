// CEOAI crawler adapter registry and deterministic task planner.
// No crawler dependencies, network calls, or subprocesses are started by this module.
// External runtimes remain disabled until an owner explicitly enables and verifies them.

const ADAPTERS = Object.freeze([
  Object.freeze({
    id: "spider",
    engine: "Spider",
    runtime: "external-sidecar",
    interface: "json-adapter-contract",
    capabilities: Object.freeze(["http", "javascript", "browser", "parallel-crawl"]),
    status: "candidate",
    enabledByDefault: false,
  }),
  Object.freeze({
    id: "scrapling",
    engine: "Scrapling",
    runtime: "python-sidecar",
    interface: "json-adapter-contract",
    capabilities: Object.freeze(["http", "javascript", "browser", "adaptive-extraction"]),
    status: "candidate",
    enabledByDefault: false,
  }),
  Object.freeze({
    id: "scrapy",
    engine: "Scrapy",
    runtime: "python-sidecar",
    interface: "json-adapter-contract",
    capabilities: Object.freeze(["http", "parallel-crawl", "sitemaps", "pipelines"]),
    status: "candidate",
    enabledByDefault: false,
  }),
]);

const TASK_CAPABILITIES = Object.freeze({
  simple: ["http"],
  javascript: ["http", "javascript"],
  browser: ["http", "javascript", "browser"],
  adaptive: ["http", "adaptive-extraction"],
  bulk: ["http", "parallel-crawl"],
});

export function listCrawlerAdapters() {
  return ADAPTERS.map(adapter => ({
    ...adapter,
    capabilities: [...adapter.capabilities],
  }));
}

export function planCrawlerTask(task = {}, options = {}) {
  const taskType = typeof task.type === "string" ? task.type : "simple";
  const required = TASK_CAPABILITIES[taskType];
  if (!required) {
    return { accepted: false, reason: "unsupported-task-type", adapter: null };
  }

  const enabled = new Set(
    Array.isArray(options.enabledAdapters)
      ? options.enabledAdapters.filter(value => typeof value === "string")
      : [],
  );
  const candidates = ADAPTERS
    .filter(adapter => enabled.has(adapter.id))
    .filter(adapter => required.every(capability => adapter.capabilities.includes(capability)))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (candidates.length === 0) {
    return {
      accepted: false,
      reason: "no-enabled-adapter-satisfies-task",
      adapter: null,
      required_capabilities: [...required],
    };
  }

  const preferred = typeof options.preferredAdapter === "string"
    ? candidates.find(adapter => adapter.id === options.preferredAdapter)
    : null;
  const selected = preferred ?? candidates[0];

  return {
    accepted: true,
    reason: null,
    adapter: selected.id,
    runtime: selected.runtime,
    required_capabilities: [...required],
    // Selection is planning only; no sidecar/runtime is invoked by this module.
    execution_enabled: false,
    execution_status: "planned-only",
    requires_runtime_binding: true,
    external_actions: false,
    paid_services: false,
  };
}

export function validateCrawlerAdapterEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { valid: false, errors: ["envelope-must-be-object"] };
  }
  if (envelope.schema_version !== "1.0") errors.push("unsupported-schema-version");
  if (typeof envelope.adapter_id !== "string" || !ADAPTERS.some(item => item.id === envelope.adapter_id)) {
    errors.push("unknown-adapter-id");
  }
  if (typeof envelope.job_id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(envelope.job_id)) {
    errors.push("invalid-job-id");
  }
  if (!Array.isArray(envelope.records)) errors.push("records-must-be-array");
  else if (envelope.records.length > 100) errors.push("record-limit-exceeded");
  if (envelope.external_actions !== false) errors.push("external-actions-must-be-disabled");
  if (envelope.paid_services !== false) errors.push("paid-services-must-be-disabled");
  return { valid: errors.length === 0, errors };
}
