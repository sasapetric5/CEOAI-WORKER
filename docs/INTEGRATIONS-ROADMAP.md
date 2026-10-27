# CEOAI — five external capability integrations

## Scope

This plan covers five capabilities, not five packages bundled into the Cloudflare Worker:

1. Lychee — broken-link checking.
2. Unlighthouse — Lighthouse-based performance audits.
3. SerpBear — search-ranking history.
4. Umami — privacy-focused, aggregated website analytics.
5. Crawl4AI — page-to-Markdown / structured extraction for AI workflows.

Umami is the initial analytics choice; Plausible is not added in parallel. This avoids duplicate analytics infrastructure.

## Architecture boundary

The Worker is the coordinator. Browser-driven audits and Python/browser crawling must run in separately hosted runners. SerpBear and Umami also require their own service/storage and authenticated access. The Worker must not try to execute CLI binaries, Chromium, or Python directly.

`src/integrations/registry.mjs` defines capability contracts and safe readiness reporting only. It makes no network requests and does not activate any integration. A status of `CONFIG_PRESENT_NOT_IMPLEMENTED` means configuration appears present, but no adapter is implemented.

The Lychee result normalizer in `src/integrations/lychee-result.mjs` is a local, deterministic parsing/sanitization layer for JSON produced by a future runner. It does not execute Lychee or make outbound requests. It validates report shape and counters, strips URL query strings/fragments, bounds text and failure entries, and ignores unknown upstream fields. This is not yet an end-to-end integration.

The Unlighthouse/Lighthouse result normalizer in `src/integrations/unlighthouse-result.mjs` accepts one Lighthouse JSON report (or a wrapper containing `lighthouseResult`), returns only allowlisted category scores and core performance metrics, strips URL query strings/fragments, and ignores arbitrary upstream fields. It does not launch Chromium or call Unlighthouse.

The SerpBear result normalizer in `src/integrations/serpbear-result.mjs` accepts bounded keyword-position snapshots, validates ranks and timestamps, drops malformed rows, and returns no upstream metadata or credentials. It does not contact SerpBear or mutate keyword tracking.

The Umami normalizer in `src/integrations/umami-result.mjs` accepts aggregate counters and bounded breakdown rows only. It deliberately excludes visitor-level records, arbitrary fields, and credentials; it does not call Umami.

The Crawl4AI normalizer in `src/integrations/crawl4ai-result.mjs` accepts bounded extraction content and an HTTP(S) source URL, removes URL query strings/fragments, and allowlists metadata, links, and image URLs. It never fetches or crawls URLs itself.

## Rollout order

1. Shared adapter contract and safety tests — no external calls, all modules disabled.
2. Lychee runner — narrow domain/page scope, bounded timeout/output, sanitized errors.
3. Unlighthouse runner — isolated browser process, strict runtime and page-count budgets.
4. SerpBear read-only adapter — authenticated reads only; do not add or change keywords automatically.
5. Umami read-only aggregate analytics — no user-level tracking data or credentials returned to clients.
6. Crawl4AI extraction — self-hosted endpoint, token stored only as a secret, explicit URL policy, bounded crawl depth, timeout and response size.

## Non-negotiable controls

- Free/self-hosted operation only; do not call hosted paid APIs or enable a paid plan.
- All integrations are off by default and fail closed.
- Never return endpoint URLs, tokens, cookies, raw upstream error bodies, or private analytics data in status responses.
- No arbitrary URL fetches until DNS/IP egress enforcement is available. Hostname checks alone do not stop DNS rebinding.
- Require authenticated access to the orchestration endpoint before any future mutating or sensitive operation.
- Enforce timeouts, response-size caps, page limits, concurrency limits, rate limits, and explicit allowlists.
- No autonomous publishing, purchases, applications, messages, or other external side effects.
- No Cloudflare dashboard/binding/secret changes without the owner's explicit approval.
- Keep changes on main; no new branches or pull requests.

## Current status

The registry and the four local result-normalization layers are parsing scaffolding only. No SerpBear, Umami, or Crawl4AI service is called by the Worker, and no integration is activated. The Lychee repository workflow can audit its configured live URL; the Unlighthouse manual workflow has been smoke-tested against `https://example.com`, not yet against the CEOAI production site. The next steps require service/runner endpoints, an explicit URL policy, resource budgets, and an authenticated adapter contract. Do not set secrets or activate integrations before those are reviewed and approved.
