import test from "node:test";
import assert from "node:assert/strict";
import { findCredentialFindings } from "../scripts/check-no-secrets.mjs";

test("detects synthetic provider tokens without returning their values", () => {
  const synthetic = "ghp_" + "A".repeat(36);
  const findings = findCredentialFindings("const token = \"" + synthetic + "\";");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "PROVIDER_TOKEN");
  assert.equal(JSON.stringify(findings).includes(synthetic), false);
});

test("detects private-key headers without exposing key material", () => {
  const findings = findCredentialFindings("-----BEGIN PRIVATE KEY-----");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "PRIVATE_KEY_HEADER");
  assert.equal(JSON.stringify(findings).includes("PRIVATE KEY"), false);
});

test("detects hardcoded credential assignments and withholds values", () => {
  const synthetic = "SYNTHETIC_" + "x".repeat(40);
  const findings = findCredentialFindings('api_key = "' + synthetic + '"');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "HARDCODED_CREDENTIAL_ASSIGNMENT");
  assert.equal(JSON.stringify(findings).includes(synthetic), false);
});

test("ignores explicit environment references and short placeholders", () => {
  assert.deepEqual(findCredentialFindings('const api_key = "process.env.API_KEY";'), []);
  assert.deepEqual(findCredentialFindings('const secret = "change_me";'), []);
});
