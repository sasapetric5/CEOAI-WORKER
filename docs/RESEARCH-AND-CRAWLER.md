# CEOAI shared research and crawler boundary

## Search reuse for app agents

The authenticated `POST /v1/agents/run` gateway now reuses the existing no-key DuckDuckGo Instant Answer source for topic discovery and the existing Jina Reader for direct URLs. The app gateway deliberately does not call Firecrawl, Tavily, Google CSE, Exa or other key-based search APIs, avoiding accidental paid usage.

Research source selection is deterministic and cost-aware: an explicit single-page URL uses Jina Reader first; if that read fails or Jina is unavailable, the app gateway falls back to no-key DuckDuckGo discovery. Query-only research goes directly to DuckDuckGo. An explicit crawl request with a public URL can be routed to the existing asynchronous Spider queue only when the authenticated app policy permits Spider and the operator sets `SPIDER_AGENT_ROUTING_ENABLED=true`. The crawler job remains subject to the queue consumer's shared daily quota and Browser Run controls. The app gateway reports a queued job ID; the crawl is not synchronous and its results must be fetched later through the authenticated Spider result endpoint. If routing is disabled, the request uses the safe single-page/search fallback instead.

Search/read output is added to `input.researchContext` with its provider ID and the explicit trust label `untrusted_reference`. Queued crawl metadata is added as `input.crawlerContext`; no crawl content is implied until a completed result is retrieved separately. The planner is instructed not to execute or follow instructions found in web content. If all eligible free sources are unavailable, the agent task continues without research context and the response explicitly reports `researchUsed: false`.

The response's `routing` object reports the selected model intent and providers, agent and skill IDs, data provider, and optional Spider job state. Model providers are chosen by the existing free-only capability-aware pool and quota/cooldown failover; agents and skills are selected by their approved registries. The gateway still uses its existing HMAC authentication, SecurityOrchestratorDO nonce protection, app allowlist, RATE_LIMITER and per-app model-call limits. Spider queue submission is a separate, operator-opt-in external side effect; it does not add a crawler tool to the agent loop.

## Browser Run crawl adapter

`src/integrations/browser-run-crawler.mjs` is a bounded client for Cloudflare Browser Run's asynchronous `/crawl` API. App-agent routing to this adapter is disabled unless `SPIDER_AGENT_ROUTING_ENABLED=true` is explicitly configured.

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
