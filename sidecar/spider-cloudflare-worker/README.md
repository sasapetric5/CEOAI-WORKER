# CEOAI Spider — experimental Cloudflare Worker

This is an isolated experimental Worker adapter. It does **not** replace the local
stdin/stdout sidecar and is not connected to CEOAI production.

## Why it exists

Cloudflare's Emscripten/Tokio integration is an experimental preview. The
project follows the upstream workers-rs Emscripten Tokio example and pins the
workers-rs source revision used for this experiment.

The manifest deliberately includes the same Spider, Reqwest, Tokio, scraper,
and URL dependencies as the local sidecar. The first gate is to prove that this
dependency graph compiles for the wasm32-unknown-emscripten target.

## Routes

- GET / — static description.
- GET /health — runtime and dependency probe metadata.
- GET /runtime-check — checks that a Tokio timer can be awaited inside a
  Worker fetch handler.

The Worker exposes GET /transport-capabilities and a fail-closed /crawl endpoint.
The latter returns HTTP 503 and confirms that no network request was made until
every transport capability is available. Native security-gate tests cover DNS
answer validation (including mixed public/private answers), private IPv4/IPv6
ranges, exact peer-IP pinning, redirect policy, and fail-closed behavior.

**Important runtime limitation:** the current Workers Fetch API surface used here
does not expose the resolved DNS answer set or the connected peer IP to this Rust
handler. Therefore this adapter cannot honestly implement DNS pinning or peer-IP
verification. The crawl endpoint is intentionally disabled; do not enable it by
loosening the gate or treating a generic fetch() success as proof of safe egress.

## Build

From this directory:

    cargo install -q worker-build
    worker-build --emscripten --release

Local preview, when the Emscripten toolchain is available:

    npx wrangler dev

The CI runs native security-gate tests and builds the Emscripten Worker. These
checks do not constitute live Cloudflare network-runtime proof. Do not deploy this
Worker or connect it to CEOAI until a supported controlled-egress primitive makes
DNS pinning and peer-IP verification possible and the complete network security
suite passes against that primitive.
