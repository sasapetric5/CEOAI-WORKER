# CEOAI shared Spider Queue

## Request

Use the HMAC-authenticated endpoint POST /v1/spider/crawl.
JSON body: {"url":"https://docs.example.com/","pageLimit":10,"depth":1,"requestId":"<UUID>"}
requestId is required and is the idempotency key. Reuse the same UUID when retrying a client request whose response may have been lost. The endpoint is available only to apps already present in the HMAC app policy allowlist. It enqueues work and returns HTTP 202; it does not run the crawl in the request lifecycle.

## Existing Cloudflare resources

- Queue: ceoai-spider-jobs
- DLQ: ceoai-spider-dlq
- Producer binding: SPIDER_QUEUE
- Ledger binding: SPIDER_LEDGER
- Result store: existing KV_MEMORY
- Browser Run token: existing secret SPIDER_BROWSER_RUN_TOKEN
- Account ID: dashboard variable SPIDER_BROWSER_RUN_ACCOUNT_ID

No additional Queue resource is intended. Wrangler declares one-message batches, max concurrency 1, five delivery retries and DLQ routing.

## Safety and reliability

- HTTPS only, public host validation, same-origin crawl, no JS rendering.
- Maximum 20 pages and depth 2 per crawl.
- Atomic five-start daily quota in a dedicated Durable Object, shared across all app callers.
- Configuration is checked before a quota slot is claimed; a transient quota-ledger failure cannot strand a job start lease.
- Per-job Durable Object ledger with atomic state transitions and request-payload consistency checks.
- A duplicate start delivery never issues a second Browser Run POST; reusing a request ID with a different URL or crawl limit is rejected internally.
- A network-ambiguous Browser Run start is marked start_unknown; automatic POST replay is forbidden.
- Poll messages are delayed 60 seconds and bounded to 60 checks.
- Results are limited to 20 Markdown records, 20,000 characters per record and 512 KB serialized output; stored for seven days.
- All crawled content is untrusted_reference.
- Invalid messages are retried and eventually routed to DLQ for inspection.

## Deployment gate

This is code/configuration only. Do not deploy until the existing queue and DLQ names are confirmed in the Cloudflare dashboard, account ID is configured, token permissions are checked, and CI passes on the exact commit. The first production smoke test should use one known public documentation URL and an explicit owner-approved test window.