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

src/integrations/registry.mjs currently defines capability contracts and safe readiness reporting only. It makes no network requests and does not activate any integration. A status of CONFIG_PRESENT_NOT_IMPLEMENTED means configuration appears present, but no adapter is implemented.

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

The registry and tests are scaffolding only. None of the five external services is called by the Worker yet. The next implementation step is Lychee, after selecting a self-hosted runner reachable over authenticated HTTPS. The other adapters follow the order above and each must pass tests before activation.
