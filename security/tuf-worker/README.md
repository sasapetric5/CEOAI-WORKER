# CEOAI Sigstore TUF Worker core

This is an isolated verification core, not a deployment or runtime activation path.

## Trust model

- Bootstrap root is pinned from Sigstore root-signing commit f22ebe7cea5352c2c3b675aa211f730e279c7b78.
- Upstream sigstore-tuf 0.15.1 verifies root chaining, threshold signatures, timestamp/snapshot/targets signatures, expiry, rollback, and hash/length pins.
- Pure-Rust P-256/SHA-256 provider supports the currently pinned root. Unsupported algorithms fail closed.
- No HTTP client, filesystem cache, candidate execution, signing, or secret access is included.
- The Worker host must fetch only fixed Sigstore TUF paths with response-size limits, hydrate cache from the existing Durable Object, and persist returned cache only after a successful result.

## Build and test

~~~sh
cargo test --manifest-path security/tuf-worker/Cargo.toml
cargo check --manifest-path security/tuf-worker/Cargo.toml --target wasm32-unknown-unknown
~~~

Fixtures are copied from the pinned upstream root-signing commit and are used only for conformance tests.
