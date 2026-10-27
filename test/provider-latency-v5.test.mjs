import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLatencyMs,
  nextLatencyEwma,
  providerLatencyRoutingAdjustment,
  LATENCY_MAX_ADJUSTMENT,
  LATENCY_ROUTING_WINDOW_MS,
} from "../src/v5-modules/provider-latency.mjs";

test("latency samples are bounded and reject invalid measurements", () => {
  assert.equal(normalizeLatencyMs(0), null);
  assert.equal(normalizeLatencyMs(-5), null);
  assert.equal(normalizeLatencyMs(120001), null);
  assert.equal(normalizeLatencyMs(Number.NaN), null);
  assert.equal(normalizeLatencyMs(129.6), 130);
});

test("latency EWMA smooths samples and initializes from the first valid sample", () => {
  assert.equal(nextLatencyEwma(null, 1000), 1000);
  assert.equal(nextLatencyEwma(1000, 2000), 1300);
  assert.equal(nextLatencyEwma(1000, 2000, 1), 2000);
  assert.equal(nextLatencyEwma(1000, 0), 1000);
});

test("routing adjustment rewards fast providers and penalizes slow providers within a bound", () => {
  const now = 10_000_000;
  assert.equal(providerLatencyRoutingAdjustment({ latencyEwmaMs: 1000, updatedAt: now }, now), LATENCY_MAX_ADJUSTMENT);
  assert.equal(providerLatencyRoutingAdjustment({ latencyEwmaMs: 15000, updatedAt: now }, now), -LATENCY_MAX_ADJUSTMENT);
  assert.equal(providerLatencyRoutingAdjustment({ latencyEwmaMs: 8250, updatedAt: now }, now), 0);
});

test("stale, future, or invalid health telemetry does not affect routing", () => {
  const now = 10_000_000;
  assert.equal(providerLatencyRoutingAdjustment({ latencyEwmaMs: 100, updatedAt: now - LATENCY_ROUTING_WINDOW_MS - 1 }, now), 0);
  assert.equal(providerLatencyRoutingAdjustment({ latencyEwmaMs: 100, updatedAt: now + 1 }, now), 0);
  assert.equal(providerLatencyRoutingAdjustment({ latencyEwmaMs: "fast", updatedAt: now }, now), 0);
  assert.equal(providerLatencyRoutingAdjustment(null, now), 0);
});
