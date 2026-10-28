// CEOAI execution policy: validate container jobs before an executor may run them.
// This module does not start containers and does not grant host access.
const MAX_TIMEOUT_SECONDS = 300;
const MAX_MEMORY_MB = 512;
const MAX_CPU_COUNT = 1;
const DENIED_ENV_KEY = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|AUTH)/i;
const SHA256_IMAGE = /^[^\s@]+@sha256:[a-f0-9]{64}$/i;

export function validateContainerJob(job) {
  const reasons = [];
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    return { allowed: false, reasons: ["job-must-be-object"] };
  }

  const image = typeof job.image === "string" ? job.image.trim() : "";
  if (!image) reasons.push("image-required");
  else if (!SHA256_IMAGE.test(image)) reasons.push("image-not-valid-digest-pinned");

  if (job.privileged === true) reasons.push("privileged-forbidden");
  if (job.network === "host" || job.network_mode === "host") reasons.push("host-network-forbidden");
  if (job.docker_socket === true || job.mount_docker_socket === true) reasons.push("docker-socket-forbidden");
  if (job.host_pid === true || job.host_ipc === true) reasons.push("host-namespace-forbidden");

  if (job.mounts !== undefined && !Array.isArray(job.mounts)) {
    reasons.push("mounts-must-be-array");
  }
  const mounts = Array.isArray(job.mounts) ? job.mounts : [];
  for (const mount of mounts) {
    if (!mount || typeof mount !== "object" || Array.isArray(mount)) {
      reasons.push("invalid-mount");
      continue;
    }
    if (mount.type === "bind" || mount.host_path || mount.source_host_path) {
      reasons.push("host-bind-mount-forbidden");
    }
    if (mount.read_only !== true) reasons.push("mount-must-be-read-only");
  }

  const timeout = job.timeout_seconds;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_SECONDS) {
    reasons.push("timeout-out-of-range");
  }
  const memory = job.memory_mb;
  if (!Number.isInteger(memory) || memory < 32 || memory > MAX_MEMORY_MB) {
    reasons.push("memory-out-of-range");
  }
  const cpu = job.cpu_count;
  if (typeof cpu !== "number" || !Number.isFinite(cpu) || cpu <= 0 || cpu > MAX_CPU_COUNT) {
    reasons.push("cpu-out-of-range");
  }

  if (job.allow_external_actions === true) reasons.push("external-actions-forbidden");
  if (job.allow_paid_services === true) reasons.push("paid-services-forbidden");
  if (job.inject_host_environment === true) reasons.push("host-environment-forbidden");

  if (job.command !== undefined &&
      (!Array.isArray(job.command) || job.command.some(part => typeof part !== "string" || !part.trim()))) {
    reasons.push("command-must-be-array-of-nonempty-strings");
  }
  if (job.environment !== undefined &&
      (!job.environment || typeof job.environment !== "object" || Array.isArray(job.environment))) {
    reasons.push("environment-must-be-object");
  }
  const env = job.environment && typeof job.environment === "object" && !Array.isArray(job.environment)
    ? job.environment : {};
  for (const [key, value] of Object.entries(env)) {
    if (DENIED_ENV_KEY.test(key)) reasons.push(`sensitive-environment-key-forbidden:${key}`);
    if (typeof value !== "string") reasons.push(`environment-value-must-be-string:${key}`);
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    limits: { timeout_seconds: MAX_TIMEOUT_SECONDS, memory_mb: MAX_MEMORY_MB, cpu_count: MAX_CPU_COUNT },
    execution_started: false,
  };
}

export function createContainerJob(input) {
  const validation = validateContainerJob(input);
  if (!validation.allowed) {
    return { ok: false, validation, job: null, execution_started: false };
  }
  return {
    ok: true,
    validation,
    job: {
      image: input.image.trim(),
      command: Array.isArray(input.command) ? [...input.command] : [],
      network: "none",
      privileged: false,
      host_pid: false,
      host_ipc: false,
      docker_socket: false,
      mounts: (input.mounts ?? []).map(mount => ({ ...mount, read_only: true })),
      timeout_seconds: input.timeout_seconds,
      memory_mb: input.memory_mb,
      cpu_count: input.cpu_count,
      allow_external_actions: false,
      allow_paid_services: false,
      inject_host_environment: false,
      environment: { ...(input.environment ?? {}) },
    },
    execution_started: false,
  };
}
