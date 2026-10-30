# CEOAI Spider sidecar (local pilot)

This is a local, stdin/stdout JSON-lines process. It is not a Cloudflare Worker route,
does not open a listening socket, and does not use Spider Cloud or an API key.

## Free local engine

- Rust crate: `spider = 2.53.9`
- License: MIT (upstream Spider crate)
- No API key, proxy subscription, paid browser service, or cloud endpoint.
- Browser rendering, link-following, and HTTP redirects are disabled in this initial pilot.
- Every target must match an exact hostname in `CEOAI_CRAWLER_APPROVED_HOSTS`.
- Spider is configured to respect robots.txt.
- One URL is fetched at a time. Requested concurrency is recorded but effective
  concurrency remains 1 until controlled load tests justify increasing it.

## Build

```sh
cargo build --release --manifest-path sidecar/spider/Cargo.toml
```

## Run

Set an explicit allowlist, then pipe one JSON request per line:

```sh
CEOAI_CRAWLER_APPROVED_HOSTS=example.org \
  sidecar/spider/target/release/ceoai-spider-sidecar < request.jsonl
```

The request must use protocol `ceoai-spider/1`, adapter `spider`, no more than
10 URLs, no more than 15 seconds per URL, and both `external_actions` and
`paid_services` must be false. Output is one JSON response per request.

## Important limits

This is an experimental local sidecar, not production-hardened isolation. The
hostname allowlist is not a substitute for OS/container egress restrictions or
DNS-rebinding protection. Run it only in a restricted environment and never
expose its stdin/stdout bridge to untrusted callers. It does not attempt to
bypass authentication, CAPTCHAs, access controls, or robots.txt.
