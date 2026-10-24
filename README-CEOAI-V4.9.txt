CEOAI.dev Worker V4.9
====================

Purpose
-------
Final targeted hardening iteration based on V4.8. The architecture remains a single Cloudflare Worker source file; HTML remains inline to preserve the existing deployment shape.

Package files
-------------
- ceoai-index-v4.9.js: deployment source for Cloudflare Worker
- ceoai-index-v4.9.mjs: byte-identical ES module copy used by Node.js tests
- test-ceoai-v4.9.mjs: local smoke/security regression tests using mocked provider responses
- CEOAI-V4.9-TEST-REPORT.txt: actual local test results and limits

Changes from V4.8
-----------------
1. Added Serbian Cyrillic sequencing words to the multi-step intent heuristic (e.g. прво, затим, након, потом, коначно).
2. Provider fallback diagnostics now distinguish a newly observed HTTP 429 from candidates skipped because they remain in cooldown. Existing cooldown-only failures use Retry-After: 120 rather than implying a fresh one-hour cooldown.
3. Added a comment documenting that session UUID validation intentionally accepts UUID v4, matching crypto.randomUUID().
4. Documented that estimatedTokensSaved is a cumulative heuristic based on validatedHistory (up to 64 input messages), not only the 16-message persisted window.
5. Added tests for whitespace-only ALLOWED_ORIGINS and pre-existing provider cooldown behavior, plus a test that Cyrillic sequencing selects the complex-provider path.

Production security configuration
---------------------------------
- Keep the native RATE_LIMITER binding configured. Atomic rate limiting is required by default.
- Set ALLOWED_ORIGINS=https://ceoai.dev and leave ALLOW_LOCAL_ORIGINS unset/false.
- Keep DEBUG_PROVIDER_ERRORS=false.
- AI remains opt-in: set AI_ENABLED=true and EXTERNAL_AI_ENABLED=true only when intentionally enabling external providers.
- Configure only provider keys/models you have independently verified. This package does not validate live provider quotas or guarantee free usage.
- Bind Workers AI only if history compression is wanted and its use/quotas are understood.

Validation limits
-----------------
The included tests run locally against mocked providers. They do not validate Cloudflare production bindings, real provider availability/quotas, browser behavior, or live deployment. Do not treat passing local tests alone as production certification. No deployment or Cloudflare/GitHub configuration changes are performed by this package.

Cloudflare deployment configuration
-----------------------------------
The repository now includes wrangler.toml for the Worker entry point, canonical
origin, disabled AI flags, KV_MEMORY, and RATE_LIMITER.

The KV_MEMORY placeholder has been replaced with the CEOAI_MEMORY namespace ID
provided from the Cloudflare dashboard. This binding has been written to the
repository, but live deployment validation has not yet been performed.
The RATE_LIMITER namespace_id must be a positive integer unique within this
Cloudflare account; the chosen value has not been verified against other Workers.
Cloudflare's Rate Limiting binding supports only 10- or 60-second windows, not an
hourly window. The current binding therefore allows up to 20 calls per 60 seconds
per Cloudflare location (approximate, not a strict global cap). The selected
namespace_id is "2026102401"; ensure no other Worker in this account uses it.
The source's local fallback counter is not used while the required RATE_LIMITER
binding is present. Do not describe the deployed binding as a 20-per-hour limit.

No Worker was deployed and no provider keys or secrets were added.
