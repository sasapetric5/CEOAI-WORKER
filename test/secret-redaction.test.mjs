import test from "node:test";
import assert from "node:assert/strict";
import { redactSensitiveText } from "../src/v5-modules/secret-redaction.mjs";

test("redacts exact configured provider keys and numbered aliases", () => {
  const secrets = {
    OPENROUTER_API_KEY: "or_live_private_123456",
    ZAI_GLM_FLASH_KEY_1: "glm_private_secret_123456",
    TOKENHARBOR_API_KEY: "harbor_private_123456",
    SPIDER_BROWSER_RUN_TOKEN: "browser_private_123456",
    APP_SECRET_CONTENTCRAFT_APP: "hmac_private_secret_123456",
  };
  const output = redactSensitiveText(
    Object.values(secrets).join(" | "),
    secrets,
  );
  for (const value of Object.values(secrets)) assert.equal(output.includes(value), false);
  assert.equal((output.match(/\[redacted\]/g) || []).length, Object.keys(secrets).length);
});

test("redacts bearer credentials and common credential fields", () => {
  const output = redactSensitiveText(
    'Authorization: Bearer abc.def_123; api_key="key value"; refresh_token=refresh123; password: secret123',
  );
  for (const secret of ["abc.def_123", "key value", "refresh123", "secret123"]) {
    assert.equal(output.includes(secret), false);
  }
  assert.match(output, /Authorization=\[redacted\]/);
});

test("redacts credential query parameters without removing harmless parameters", () => {
  const output = redactSensitiveText(
    "https://example.test/path?topic=queues&api_key=private123&access_token=private456&lang=sr",
  );
  assert.match(output, /topic=queues/);
  assert.match(output, /lang=sr/);
  assert.equal(output.includes("private123"), false);
  assert.equal(output.includes("private456"), false);
});

test("does not redact harmless words that merely contain key as a substring", () => {
  const output = redactSensitiveText("monkey business; keyboard layout; tokenized request", {});
  assert.equal(output, "monkey business; keyboard layout; tokenized request");
});

test("bounds diagnostic text and safely handles missing values", () => {
  assert.equal(redactSensitiveText("x".repeat(2000)).length, 1200);
  assert.equal(redactSensitiveText(null), "");
  assert.equal(redactSensitiveText(undefined), "");
});


test("redacts configured secrets in full conversation-sized content without truncating safe text", () => {
  const key = "provider_live_secret_987654321";
  const content = "Useful conversation context. ".repeat(60) + "OPENROUTER_API_KEY=" + key + " " + "More safe context. ".repeat(20);
  const output = redactSensitiveText(content, { OPENROUTER_API_KEY: key }, 2000);
  assert.equal(output.includes(key), false);
  assert.ok(output.length > 1200);
  assert.ok(output.includes("More safe context."));
});

test("redacts secrets embedded in JSON-like request content", () => {
  const content = '{"apiKey":"private_key_123456","access_token":"private_token_123456","topic":"safe"}';
  const output = redactSensitiveText(content, {}, 2000);
  assert.equal(output.includes("private_key_123456"), false);
  assert.equal(output.includes("private_token_123456"), false);
  assert.ok(output.includes("safe"));
});


test("redacts provider-specific API headers and session cookies", () => {
  const output = redactSensitiveText(
    "x-goog-api-key: google_private_123; x-auth-token=auth_private_123; Cookie: session=private_session_123; Set-Cookie: refresh_token=private_refresh_123",
  );
  for (const secret of ["google_private_123", "auth_private_123", "private_session_123", "private_refresh_123"]) {
    assert.equal(output.includes(secret), false);
  }
});
