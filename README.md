# CEOAI-WORKER

**CEOAI.dev — secure AI chat** (Cloudflare Worker)

## Current version: V5.0

See `README-CEOAI-V5.0.txt` for full documentation.

### Quick verify

```bash
npm run verify
```

### Deploy

- Entry: `ceoai-index-v5.0.mjs`, configured in `wrangler.toml`.
- Production deployment is the manual `CEOAI Worker production deploy` workflow. Run it from `main` and enter `deploy`; it verifies the selected commit, builds the TUF WASM module, checks the Wrangler dry-run and required bindings, then deploys that same commit.
- Configure the GitHub `production` environment with required reviewers and restrict it to `main`. Also set Actions secret `CLOUDFLARE_API_TOKEN` and variable `CLOUDFLARE_ACCOUNT_ID`. Keep provider and HMAC credentials in Cloudflare secrets, never in the repository.
- Confirm the `ceoai.dev` Worker route/custom domain in Cloudflare; `ALLOWED_ORIGINS` is a browser-origin policy, not a domain/route attachment.
- The browser chat requires `KV_MEMORY` and `RATE_LIMITER`; HMAC app routes require `SECURITY_DO`, and the agent gateway also uses `WORKFLOW_TASKS`. Signed tool execution additionally requires `CAPABILITY_AUTHORITY`; Spider requires `SPIDER_QUEUE`, `SPIDER_LEDGER`, and its Browser Run account ID/token.
- External AI remains opt-in. Enable it only after configuring and verifying a provider, its model, and its billing/free-tier limits.
- Agent tools and external side effects remain disabled by default; do not enable publishing or other actions without a reviewed approval and idempotency flow.
- Before enabling production traffic, smoke-test the homepage, `/api/chat`, memory reset and a signed `/v1/agents/run` request. CI dry-run cannot verify live secrets, account permissions, provider quotas or domain routing.

For local checks, run `npm run verify`. A local Wrangler dry-run also requires Rust and the generated verifier; run `npm run build:tuf` first.

V4.9 sources are retained for reference.
