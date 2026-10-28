import test from "node:test";
import assert from "node:assert/strict";
import { createContainerJob, validateContainerJob } from "../src/v5-modules/execution-policy.mjs";

const safeJob = () => ({
  image: "node@sha256:" + "a".repeat(64),
  command: ["node", "--test"],
  timeout_seconds: 120,
  memory_mb: 256,
  cpu_count: 1,
  network: "none",
  privileged: false,
  host_pid: false,
  host_ipc: false,
  docker_socket: false,
  mounts: [],
  allow_external_actions: false,
  allow_paid_services: false,
  inject_host_environment: false,
  environment: { NODE_ENV: "test" },
});

test("accepts a bounded, network-disabled, digest-pinned container job", () => {
  const result = validateContainerJob(safeJob());
  assert.equal(result.allowed, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.execution_started, false);
});

test("rejects unsafe host access and privilege flags", () => {
  for (const patch of [
    { privileged: true },
    { network: "host" },
    { docker_socket: true },
    { host_pid: true },
    { host_ipc: true },
    { inject_host_environment: true },
    { allow_external_actions: true },
    { allow_paid_services: true },
  ]) {
    assert.equal(validateContainerJob({ ...safeJob(), ...patch }).allowed, false);
  }
});

test("rejects mutable image tags, unbounded resources and writable host mounts", () => {
  assert.ok(validateContainerJob({ ...safeJob(), image: "node:latest" }).reasons.includes("image-not-digest-pinned"));
  assert.ok(validateContainerJob({ ...safeJob(), timeout_seconds: 301 }).reasons.includes("timeout-out-of-range"));
  assert.ok(validateContainerJob({ ...safeJob(), memory_mb: 1024 }).reasons.includes("memory-out-of-range"));
  assert.ok(validateContainerJob({ ...safeJob(), cpu_count: 2 }).reasons.includes("cpu-out-of-range"));
  assert.ok(validateContainerJob({
    ...safeJob(),
    mounts: [{ type: "bind", host_path: "/etc", read_only: true }],
  }).reasons.includes("host-bind-mount-forbidden"));
});

test("rejects secret-like environment variable names", () => {
  const result = validateContainerJob({
    ...safeJob(),
    environment: { API_TOKEN: "should-not-be-here" },
  });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some(reason => reason.startsWith("sensitive-environment-key-forbidden:")));
});

test("job builder fails closed and hardens accepted jobs", () => {
  const rejected = createContainerJob({ ...safeJob(), privileged: true });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.job, null);

  const accepted = createContainerJob(safeJob());
  assert.equal(accepted.ok, true);
  assert.equal(accepted.job.network, "none");
  assert.equal(accepted.job.privileged, false);
  assert.equal(accepted.job.docker_socket, false);
  assert.equal(accepted.job.allow_external_actions, false);
  assert.equal(accepted.job.allow_paid_services, false);
  assert.equal(accepted.execution_started, false);
});
