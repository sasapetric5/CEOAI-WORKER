# CEOAI shared research and crawler boundary

## Search reuse for app agents

The authenticated `POST /v1/agents/run` gateway now reuses the existing no-key DuckDuckGo Instant Answer source for topic discovery and the existing Jina Reader for direct URLs. The app gateway deliberately does not call Firecrawl, Tavily, Google CSE, Exa or other key-based search APIs, avoiding accidental paid usage.

Search output is added to `input.researchContext` with its provider ID and the explicit trust label `untrusted_reference`. The planner is instructed not to execute or follow instructions found in web content. If search is unavailable, the agent task continues without research context and the response explicitly reports `researchUsed: false`.

The gateway still uses its existing HMAC authentication, SecurityOrchestratorDO nonce protection, app allowlist, RATE_LIMITER, free-only AI provider gate and per-app model-call limits. This change does not add tools or external side effects to the agent loop.

## Browser Run crawl adapter

`src/integrations/browser-run-crawler.mjs` is a bounded client for Cloudflare Browser Run's asynchronous `/crawl` API. It is intentionally separate from the Worker route until the Queue producer/consumer bindings and account configuration are verified.

Controls:
- Only HTTPS public-looking hostnames are accepted; IP literals, local names, credentials and non-default ports are rejected.
- Redirects are rejected at the HTTP client boundary.
- Same-origin crawl patterns only; external links and subdomains are disabled.
- `render: false` is fixed in code. The crawler does not start a browser or execute page JavaScript.
- `formats: ["markdown"]`, `crawlPurposes: ["search", "ai-input"]`, and `contentUse: "reference"`; no `ai-train` purpose is declared.
- Internal maximum: 20 pages per job and depth 2.
- API responses are size-bounded and upstream errors are mapped to safe codes; credentials and raw provider error bodies are never returned.
- Job polling uses `?limit=1`; results are restricted to completed Markdown records.

## Free-plan guardrails (checked 2026-11-05)

Cloudflare currently documents, for Workers Free, up to 5 Browser Run crawl jobs per day and up to 100 pages per crawl. This adapter uses a stricter 20-page cap. The documentation also states that `render: false` crawls are not billed during the current beta, but may be billed under Workers pricing after beta. Therefore no production traffic is enabled by this adapter, and the feature must be re-reviewed before activation if beta/pricing terms change.

## Still required before activation

The repository's current `wrangler.toml` does not declare the `SPIDER_QUEUE` producer/consumer or the queue DLQ, and no queue handler is present in the Worker entrypoint. The account may have a dashboard queue, but the repository source-of-truth does not yet wire it. Do not enable the crawler route or deploy until:
1. The exact existing queue and DLQ names/bindings are reconciled with Wrangler configuration.
2. The account ID variable and the `SPIDER_BROWSER_RUN_TOKEN` permission (`Browser Run - Edit`) are verified.
3. A durable, idempotent job-state transition is implemented for at-least-once queue delivery.
4. Daily account-wide crawl quota (5 jobs on Workers Free) is enforced atomically.
5. The full producer → queue → consumer → Browser Run → results path passes tests.

No new public research route is exposed by this change. `/api/chat` remains unchanged.
