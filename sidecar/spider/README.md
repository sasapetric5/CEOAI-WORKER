# CEOAI Spider sidecar (local pilot)

This is a local, stdin/stdout JSON-lines process. It is not a Cloudflare Worker
route, does not open a listening socket, and does not use Spider Cloud or an API
key.

## Free local engine

- Rust crate: `spider = 2.53.9` (MIT upstream license).
- No API key, proxy subscription, paid browser service, or cloud endpoint.
- Browser rendering and link-following are disabled.
- Page redirects are disabled; robots.txt redirects are separately guarded.
- Every target must match an exact hostname in
  `CEOAI_CRAWLER_APPROVED_HOSTS`.
- Spider uses the custom `GuardedHttpEngine`; page requests do not use the
  default Spider HTTP transport.
- One URL is fetched at a time. Effective concurrency remains 1.

## Guarded transport

- Only HTTP/HTTPS and ports 80/443 are accepted; embedded credentials and
  literal-IP targets are rejected.
- DNS results are checked for public addresses, and the checked addresses are
  pinned into the HTTP client to prevent a second independent DNS lookup.
- The connected peer address is checked against the pinned address set.
- Redirects are disabled for page fetches. robots.txt redirects are limited,
  same-host only, and validated at every hop.
- Response bodies are streamed with a hard 2 MiB cap. Declared content length
  is checked before reading, and chunked/unknown-length bodies are stopped as
  soon as the cap would be exceeded.
- A total transport timeout bounds DNS, connection, redirects, and body read.
- Retry-After handling is enabled by default for 429/503 responses, with a
  bounded retry count and bounded delay.
- Requests are serialized and include a minimum inter-URL delay. A robots
  Crawl-delay is applied before the page fetch.

## robots.txt

robots.txt is fetched through the guarded transport before each page request.
The parser handles user-agent product-token groups, Allow/Disallow, wildcard
patterns, end anchors, longest-match precedence, and Allow on equal-length
matches. A robots fetch failure other than a clear 4xx response is treated
conservatively as a denial. This is a deliberately scoped parser; do not claim
complete RFC 9309 conformance without additional interoperability testing.

## Build and run

```sh
cargo build --release --manifest-path sidecar/spider/Cargo.toml
```

Set an explicit allowlist, then pipe one JSON request per line:

```sh
CEOAI_CRAWLER_APPROVED_HOSTS=example.org \
  sidecar/spider/target/release/ceoai-spider-sidecar < request.jsonl
```

The request uses protocol `ceoai-spider/1`, adapter `spider`, no more than
10 URLs, no more than 15 seconds per URL, and both `external_actions` and
`paid_services` must be false.

## Important limits

This remains an experimental local sidecar, not production-hardened isolation.
Use OS/container egress restrictions as a second security boundary and never
expose its stdin/stdout bridge directly to untrusted callers. It does not
bypass authentication, CAPTCHAs, access controls, or robots.txt.

The Cloudflare Emscripten Worker experiment is isolated under
`sidecar/spider-cloudflare-worker`. It is only a runtime/build compatibility
probe and is not connected to CEOAI production. Its successful compile would
not, by itself, prove that the guarded transport's DNS pinning and peer-IP
verification behave identically in the Workers runtime.
