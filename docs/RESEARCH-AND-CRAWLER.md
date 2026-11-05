# CEOAI shared research and crawler boundary

## Search reuse for app agents

The authenticated `POST /v1/agents/run` gateway now reuses the existing no-key DuckDuckGo Instant Answer source for topic discovery and the existing Jina Reader for direct URLs. The app gateway deliberately does not call Firecrawl, Tavily, Google CSE, Exa or other key-based search APIs, avoiding accidental paid usage.

Research source selection is deterministic and cost-aware: an explicit single-page URL uses Jina Reader first; if that read fails or Jina is unavailable, the app gateway falls back to no-key DuckDuckGo discovery. Query-only research goes directly to DuckDuckGo. Browser Run is not an automatic app-agent tool: the public agent gateway grants no Browser Run capability. The separate HMAC-protected Spider endpoint remains the only entry point, and any future Supervisor tool must also require explicit crawl intent, caller capability, and an available shared daily quota slot.

Search/read output is added to `input.researchContext` with its provider ID and the explicit trust label `untrusted_reference`. The planner is instructed not to execute or follow instructions found in web content. If all eligible free sources are unavailable, the agent task continues without research context and the response explicitly reports `researchUsed: false`.

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

The repository now declares the existing ceoai-spider-jobs producer/consumer, the existing ceoai-spider-dlq, and a separate SpiderJobLedgerDO binding. The HMAC-protected POST /v1/spider/crawl endpoint requires an idempotency requestId, and the Worker exports a Queue consumer handler.

The consumer uses one-message batches and max concurrency 1, enforces a five-start daily budget in an atomic Durable Object, records job transitions, stores bounded results in existing KV_MEMORY, and retries transient status/result failures. Messages that exhaust the configured five retries are routed to the existing DLQ. Ambiguous Browser Run start outcomes are marked start_unknown and are never automatically POSTed again, avoiding duplicate quota-consuming crawls.

Before enabling in production, verify that the existing Cloudflare queue names match these declarations, that SPIDER_BROWSER_RUN_ACCOUNT_ID is set, and that SPIDER_BROWSER_RUN_TOKEN has only the required Browser Run permission. The queue and ledger changes are source-only until a separately approved deployment. /api/chat remains unchanged.
