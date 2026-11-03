import test from "node:test";
import assert from "node:assert/strict";
import { redactPII, sanitizeLogData } from "../src/v5-modules/pii-shield.mjs";

test("redacts sensitive object keys but preserves safe token counters", () => {
  const out = redactPII({ appId: "CONTENTCRAFT-APP", apiKey: "secret", "X-Signature": "sig", email: "a@example.com", max_tokens: 900, nested: { clientSecret: "x" } });
  assert.equal(out.appId, "CONTENTCRAFT-APP");
  assert.equal(out.apiKey, "[REDACTED]");
  assert.equal(out["X-Signature"], "[REDACTED]");
  assert.equal(out.email, "[REDACTED]");
  assert.equal(out.max_tokens, 900);
  assert.equal(out.nested.clientSecret, "[REDACTED]");
});

test("redacts secrets embedded in strings", () => {
  const out = redactPII("mail a@example.com Bearer abc.def sk_live_AbC123 token=secret123");
  for (const leak of ["a@example.com", "abc.def", "AbC123", "secret123"]) assert.equal(out.includes(leak), false);
});

test("bounds recursion and collection sizes; detects cycles", () => {
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(redactPII(cyclic).self, "[CIRCULAR_REFERENCE]");
  const array = redactPII(Array.from({ length: 150 }, (_, i) => i));
  assert.equal(array.length, 101);
  let deep = {}; for (let i = 0; i < 20; i++) deep = { child: deep };
  assert.ok(JSON.stringify(redactPII(deep)).includes("[MAX_DEPTH_REACHED]"));
});

test("does not mutate input or invoke getters", () => {
  let called = false;
  const input = { password: "p", get dangerous() { called = true; return "x"; } };
  const out = redactPII(input);
  assert.equal(called, false);
  assert.equal(out.dangerous, "[ACCESSOR_OMITTED]");
  assert.equal(input.password, "p");
});

test("handles errors, dates and binary data", () => {
  assert.equal(redactPII(new Error("password=secret")).message.includes("secret"), false);
  assert.equal(redactPII(new Date(0)), "1970-01-01T00:00:00.000Z");
  assert.equal(redactPII(new Uint8Array(3)), "[BINARY 3 bytes]");
  assert.equal(sanitizeLogData, redactPII);
});
