# CEOAI Spider — experimental Cloudflare Worker

This is an isolated compatibility probe. It does **not** replace the local
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

No crawl route is exposed yet. A successful build or timer test is not proof
that guarded DNS pinning, peer-IP verification, redirects, streaming limits,
robots.txt, or Retry-After work on Emscripten.

## Build

From this directory:

    cargo install -q worker-build
    worker-build --emscripten --release

Local preview, when the Emscripten toolchain is available:

    npx wrangler dev

Do not deploy this Worker or connect it to CEOAI until the complete guarded
transport and network security suite passes in the Workers runtime.
