// Encrypted credential vault adapter. Raw credentials are never stored as KV values or metadata.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ID = /^[a-z0-9][a-z0-9_-]{2,63}$/i;
const PROVIDER = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const VERSION = 1;
const AAD_PREFIX = "ceoai-credential-vault:v1:";

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("INVALID_BASE64");
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function encryptionKey(encodedKey) {
  const raw = fromBase64(encodedKey);
  if (raw.byteLength !== 32) throw new Error("CREDENTIAL_VAULT_KEY_MUST_BE_32_BYTES");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
function validStore(store) {
  return store && typeof store.get === "function" && typeof store.put === "function" && typeof store.delete === "function";
}
function recordKey(providerId, credentialId) {
  if (!PROVIDER.test(providerId || "") || !ID.test(credentialId || "")) throw new Error("INVALID_CREDENTIAL_REFERENCE");
  return "credentials:v1:secret:" + providerId + ":" + credentialId;
}
function metadataKey(providerId, credentialId) {
  return "credentials:v1:metadata:" + providerId + ":" + credentialId;
}
function aad(providerId, credentialId) {
  return encoder.encode(AAD_PREFIX + providerId + ":" + credentialId);
}

export class EncryptedCredentialVault {
  constructor({ store, encryptionKeyBase64 } = {}) {
    if (!validStore(store)) throw new TypeError("CREDENTIAL_VAULT_STORE_REQUIRED");
    if (typeof encryptionKeyBase64 !== "string" || !encryptionKeyBase64) throw new TypeError("CREDENTIAL_VAULT_ENCRYPTION_KEY_REQUIRED");
    this.store = store;
    this.keyPromise = encryptionKey(encryptionKeyBase64);
  }

  async put({ providerId, credentialId, secret, metadata = {} } = {}) {
    const key = recordKey(providerId, credentialId);
    const metaKey = metadataKey(providerId, credentialId);
    if (typeof secret !== "string" || secret.length < 8 || secret.length > 8192) throw new TypeError("INVALID_CREDENTIAL_SECRET");
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new TypeError("INVALID_CREDENTIAL_METADATA");
    const safeMetadata = {};
    for (const [name, value] of Object.entries(metadata)) {
      if (!/^(status|expiresAt|lastCheckedAt|quotaResetAt|createdAt|updatedAt|label|source)$/.test(name)) {
        throw new Error("UNSUPPORTED_CREDENTIAL_METADATA_FIELD");
      }
      if (typeof value !== "string" && typeof value !== "number" && value !== null) throw new TypeError("INVALID_CREDENTIAL_METADATA_VALUE");
      if (typeof value === "string" && value.length > 256) throw new TypeError("CREDENTIAL_METADATA_VALUE_TOO_LONG");
      safeMetadata[name] = value;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encoder.encode(secret);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(providerId, credentialId), tagLength: 128 }, await this.keyPromise, plaintext);
    const envelope = {
      version: VERSION,
      algorithm: "A256GCM",
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext))
    };
    // Store secret and metadata separately. The metadata allowlist excludes secret-like fields.
    await this.store.put(key, JSON.stringify(envelope));
    await this.store.put(metaKey, JSON.stringify({ version: VERSION, providerId, credentialId, ...safeMetadata }));
    return { providerId, credentialId, stored: true, encrypted: true, metadata: safeMetadata };
  }

  async get({ providerId, credentialId } = {}) {
    const key = recordKey(providerId, credentialId);
    const raw = await this.store.get(key);
    if (raw === null || raw === undefined) return null;
    let envelope;
    try { envelope = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { throw new Error("CREDENTIAL_VAULT_CORRUPT"); }
    if (!envelope || envelope.version !== VERSION || envelope.algorithm !== "A256GCM") throw new Error("CREDENTIAL_VAULT_UNSUPPORTED_ENVELOPE");
    const iv = fromBase64(envelope.iv);
    const ciphertext = fromBase64(envelope.ciphertext);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 16 || ciphertext.byteLength > 16_400) throw new Error("CREDENTIAL_VAULT_INVALID_ENVELOPE");
    try {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(providerId, credentialId), tagLength: 128 }, await this.keyPromise, ciphertext);
      return decoder.decode(plaintext);
    } catch {
      throw new Error("CREDENTIAL_VAULT_AUTHENTICATION_FAILED");
    }
  }

  async getMetadata({ providerId, credentialId } = {}) {
    const raw = await this.store.get(metadataKey(providerId, credentialId));
    if (raw === null || raw === undefined) return null;
    try {
      const value = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!value || value.providerId !== providerId || value.credentialId !== credentialId || value.version !== VERSION) return null;
      return value;
    } catch {
      return null;
    }
  }

  async delete({ providerId, credentialId } = {}) {
    const key = recordKey(providerId, credentialId);
    await this.store.delete(key);
    await this.store.delete(metadataKey(providerId, credentialId));
    return { providerId, credentialId, deleted: true };
  }
}
