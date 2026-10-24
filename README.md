# CEOAI-WORKER

**CEOAI.dev — secure AI chat** (Cloudflare Worker)

## Current version: V5.0

See `README-CEOAI-V5.0.txt` for full documentation.

### Quick verify

```bash
npm run verify
```

### Deploy

- Entry: `ceoai-index-v5.0.mjs` (configured in `wrangler.toml`)
- Requires `KV_MEMORY` + `RATE_LIMITER` bindings
- External AI is opt-in; free-only gates for providers that can bill

V4.9 sources are retained for reference.
