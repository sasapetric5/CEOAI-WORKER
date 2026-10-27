import test from "node:test";
import assert from "node:assert/strict";
import { providerHealthRoutingAdjustment, providerRecoveryAction } from "../src/v5-modules/provider-recovery.mjs";

test("health adjustment only breaks ties and rewards recent healthy providers", () => {
  const now = 100_000;
  assert.equal(providerHealthRoutingAdjustment({ status: "healthy", consecutiveFailures: 0, updatedAt: now }, now), 0.2);
  assert.equal(providerHealthRoutingAdjustment({ status: "unavailable", consecutiveFailures: 2, updatedAt: now }, now), -0.2);
  assert.equal(providerHealthRoutingAdjustment(null, now), 0);
});

test("stale health does not penalize a provider forever", () => {
  const now = 10_000_000;
  assert.equal(providerHealthRoutingAdjustment({ status: "unavailable", consecutiveFailures: 3, updatedAt: now - 3_600_001 }, now), 0);
});

test("recovery policy permits a probe after cooldown and identifies successful recovery", () => {
  const now = 200_000;
  assert.equal(providerRecoveryAction({ status: "rate_limited", updatedAt: now, consecutiveFailures: 1 }, now), "probe_after_cooldown");
  assert.equal(providerRecoveryAction({ status: "healthy", updatedAt: now, consecutiveFailures: 0 }, now), "recovered");
  assert.equal(providerRecoveryAction({ status: "unavailable", updatedAt: now - 3_600_001, consecutiveFailures: 2 }, now), "normal");
});
