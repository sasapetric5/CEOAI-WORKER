import test from "node:test";
import assert from "node:assert/strict";
import { EncryptedCredentialVault } from "../src/credentials/encrypted-credential-vault.mjs";

const KEY = Buffer.alloc(32, 7).toString("base64");
function makeStore() {
  const values = new Map();
  return { values, async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async delete(key) { values.delete(key); } };
}

test("vault encrypts credentials at rest and stores metadata separately", async () => {
  const store = makeStore();
  const vault = new EncryptedCredentialVault({ store, encryptionKeyBase64: KEY });
  const secret = "nvidia_private_api_key_123";
  const result = await vault.put({ providerId: "nvidia_build", credentialId: "primary_key", secret, metadata: { status: "active", expiresAt: "2027-01-01T00:00:00Z" } });
  assert.equal(result.encrypted, true);
  const raw = store.values.get("credentials:v1:secret:nvidia_build:primary_key");
  assert.equal(raw.includes(secret), false);
  assert.equal(await vault.get({ providerId: "nvidia_build", credentialId: "primary_key" }), secret);
  assert.equal((await vault.getMetadata({ providerId: "nvidia_build", credentialId: "primary_key" })).status, "active");
});

test("vault rejects secret-like metadata fields", async () => {
  const vault = new EncryptedCredentialVault({ store: makeStore(), encryptionKeyBase64: KEY });
  await assert.rejects(vault.put({ providerId: "bytez", credentialId: "main_key", secret: "private_key_123", metadata: { apiKey: "must-not-store" } }), /UNSUPPORTED_CREDENTIAL_METADATA_FIELD/);
});

test("vault rejects missing encryption key and invalid identifiers", () => {
  assert.throws(() => new EncryptedCredentialVault({ store: makeStore() }), /ENCRYPTION_KEY_REQUIRED/);
  const vault = new EncryptedCredentialVault({ store: makeStore(), encryptionKeyBase64: KEY });
  return assert.rejects(vault.get({ providerId: "../other", credentialId: "main_key" }), /INVALID_CREDENTIAL_REFERENCE/);
});

test("vault detects ciphertext tampering and wrong encryption keys", async () => {
  const store = makeStore();
  const vault = new EncryptedCredentialVault({ store, encryptionKeyBase64: KEY });
  await vault.put({ providerId: "bytez", credentialId: "main_key", secret: "bytez_private_key_123" });
  const storageKey = "credentials:v1:secret:bytez:main_key";
  const envelope = JSON.parse(store.values.get(storageKey));
  envelope.ciphertext = Buffer.alloc(Buffer.from(envelope.ciphertext, "base64").length, 1).toString("base64");
  store.values.set(storageKey, JSON.stringify(envelope));
  await assert.rejects(vault.get({ providerId: "bytez", credentialId: "main_key" }), /AUTHENTICATION_FAILED/);
});

test("vault supports removal of secret and metadata", async () => {
  const store = makeStore();
  const vault = new EncryptedCredentialVault({ store, encryptionKeyBase64: KEY });
  await vault.put({ providerId: "bytez", credentialId: "main_key", secret: "bytez_private_key_123", metadata: { status: "active" } });
  await vault.delete({ providerId: "bytez", credentialId: "main_key" });
  assert.equal(await vault.get({ providerId: "bytez", credentialId: "main_key" }), null);
  assert.equal(await vault.getMetadata({ providerId: "bytez", credentialId: "main_key" }), null);
});
