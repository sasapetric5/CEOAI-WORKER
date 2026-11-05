# CEOAI API Keys Harvester — authorized credential lifecycle manager

This module is an **authorized provider onboarding and credential lifecycle manager**, not a public-secret harvester.

## Current reviewed provider catalog

- NVIDIA Build / NIM: owner creates the initial account and key in the official dashboard. NVIDIA NGC personal keys have configurable expiry and dashboard rotation; a new key must be safely captured at creation. API-based key issuance has not been verified, so rotation is owner-assisted.
- Bytez: owner creates the account and key in the official dashboard. Its published Free plan documents $1 credits refreshed every 4 weeks, credits expiring 4 weeks after grant, and open-model access up to 7B. The billing docs also describe auto-reload and auto-scale that can cause charges; CEOAI must keep both disabled and must never add a payment method or purchase credits.

The catalog is source metadata only. It does not issue keys, authenticate to portals, or claim live quota data.

## Lifecycle policy

The lifecycle engine distinguishes active, expiring, expired, invalid, revoked, quota exhausted, rate limited, check due and unknown. A 401/403 is an authentication or access failure, a 429 is a rate-limit signal, and a documented Bytez 402 insufficient-credit response is quota exhaustion. Unknown provider state remains unknown until checked through a documented signal.

Rotation is two-phase: owner-authorized replacement is staged, verified through a documented low-risk method, traffic is switched, and the old credential is revoked only after the new credential is confirmed. No key is revoked before replacement. If the provider does not expose a documented issuance API, use an owner-assisted portal flow. Do not bypass MFA, CAPTCHA, rate limits, or portal controls.

## Encrypted credential vault

`EncryptedCredentialVault` uses AES-256-GCM with a fresh 96-bit IV per write and binds ciphertext to provider and credential IDs as additional authenticated data. Secret ciphertext and allowlisted metadata are stored separately. Raw credentials are never stored in metadata.

The constructor requires a dedicated 32-byte base64 master key (`CREDENTIALS_ENCRYPTION_KEY`) and a KV-compatible store adapter. Missing or invalid key material fails closed. Do not reuse provider API keys as the vault master key. Back up and rotate the master key only through a separately tested migration procedure; losing it makes stored credentials unrecoverable.

## Not yet enabled

- No public HTTP endpoint or dashboard is exposed.
- No Cloudflare KV binding or `CREDENTIALS_ENCRYPTION_KEY` secret has been added to production.
- No cron schedule is enabled.
- No portal cookies or browser sessions are persisted.
- No automatic account creation, payment, auto-reload, auto-scale, or provider-key issuance API is enabled.
- No live provider key or quota validation has been run.

Before enabling runtime monitoring, wire a dedicated KV binding and encryption secret in a non-production test environment, then test expiry/rotation with synthetic keys. Add a scheduled monitor only after its free-tier limits and request budgets are verified. Keep provider adapters read-only until a separate owner-approved implementation exists.
