# CEOAI Spider — Cloudflare Queue / Browser Run adapter

This directory contains the earlier Rust/Emscripten compatibility probe. It is kept as an isolated experiment and is not the production crawler transport.

The supported Cloudflare integration lives in `src/v5-modules/spider-cloudflare-queue.mjs` and is connected to CEOAI V5:
- `POST /api/crawl` submits an authenticated crawl job.
- Cloudflare Queue consumer starts an asynchronous Browser Run `/crawl` job.
- `GET /api/crawl/{job_id}` polls the job and returns the normalized protocol result.
- `KV_MEMORY` stores owner-scoped job state and results.

## Runtime architecture
1. CEOAI session submits a bounded crawl request.
2. CEOAI validates HTTP(S), rejects credentials, IP literals and non-standard ports, and requires an exact hostname in `SPIDER_APPROVED_HOSTS`.
3. The request is sent to the `ceoai-spider-jobs` Queue.
4. Queue consumer calls Cloudflare Browser Run `/crawl` and stores the Cloudflare job ID in `KV_MEMORY`.
5. Polling retrieves Markdown results, normalizes them to `ceoai-spider/1`, calculates SHA-256 hashes and stores the result.
6. Results are session-owner scoped. External actions and paid services are always false.

The remote fetch/render engine is Cloudflare Browser Run, not the native Rust Spider HTTP client. The adapter preserves the CEOAI Spider protocol and source-approval boundary. The native Rust Spider sidecar remains available for local guarded HTTP crawling. This separation is intentional: the Emscripten Worker does not claim native Rust DNS pinning or peer-IP verification.

## Free-first limits
- Maximum 10 pages per job; maximum depth 2.
- Default `render: false` to avoid browser-hour consumption.
- JavaScript rendering requires `SPIDER_RENDER_JS_ENABLED=true` and request `render: true`.
- Cloudflare documents 5 crawl jobs/day and 10 browser minutes/day on Workers Free.
- Queue batch size 1, maximum 2 retries.
- Result response hard cap 2 MiB; Markdown per page capped at 20,000 characters.
- Job state expires after 24 hours.
- Reuses `KV_MEMORY` with `spider:job:` prefix; no new KV namespace.
- Does not use Workers AI JSON extraction.

Cloudflare Free allowances are ceilings, not unlimited capacity. The integration is opt-in and defaults to disabled. It does not change the account plan or enable paid services.

## Required Cloudflare setup (not performed by code changes)
1. Create a Queue named `ceoai-spider-jobs` in Cloudflare.
2. Create an API token scoped only to the account's Browser Run Edit permission. Do not use a Global API Key.
3. Add Worker variable `CLOUDFLARE_ACCOUNT_ID`.
4. Add Worker secret `BROWSER_RUN_API_TOKEN`.
5. Set `SPIDER_APPROVED_HOSTS` to exact approved hostnames, comma-separated.
6. Only after confirming Workers Free and its limits, set `SPIDER_CLOUDFLARE_ENABLED=true`.
7. Keep `SPIDER_RENDER_JS_ENABLED=false` unless JS rendering is necessary and its free browser-time budget is monitored.

The repository declares the Queue binding but does not create the Queue, set secrets, change billing, or deploy anything. Do not enable until the Queue and scoped token exist.

## API contract
Submit `POST /api/crawl` with JSON:
```json
{
  "url": "https://example.org/docs/",
  "page_limit": 5,
  "depth": 1,
  "render": false
}
```

Poll `GET /api/crawl/{job_id}`.

The result uses `ceoai-spider/1`, `adapter_id: "spider"`, and source records with HTTP status, robots permission, extractor metadata, evidence, content hash and Markdown. `execution.engine` explicitly identifies `cloudflare-browser-run`.

## Security notes
- CEOAI session cookie, allowed origin and existing IP rate limiter are required.
- Queue messages contain no provider secrets or user cookies.
- Callers cannot provide arbitrary request headers, authentication cookies or browser scripts.
- Browser Run respects `robots.txt`, crawl-delay and Cloudflare bot protections; it does not bypass CAPTCHAs or access controls.
- Only same-host results are admitted to CEOAI protocol records.
- The adapter does not claim raw socket peer-IP verification. It uses Cloudflare's managed crawler boundary.

## Previous Emscripten probe
The Rust/Emscripten build scripts remain for reproducibility. A successful wasm build proves dependency compilation and timer compatibility only; it does not prove native Rust guarded transport works inside Workers. Do not deploy the experimental Rust Worker as the crawler.