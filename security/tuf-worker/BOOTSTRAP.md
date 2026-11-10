# Sigstore TUF bootstrap provenance

The embedded bootstrap is **Sigstore Public Good TUF root version 10**.

- Upstream repository: `sigstore/root-signing`
- Upstream path: `metadata/root_history/10.root.json`
- Pinned upstream commit: `03f9c7e0023c917b60eb7431e87f47e6a636f37a`
- Upstream Git blob SHA-1: `3f18ee74ca6415a3a8dbdc30be69fc1b1703c02f`
- Embedded file SHA-256: `836bff947925edfc23eb9ce17af66fb1e43bb5e2bdd240520985ae52b585eae9` (enforced by Rust before parsing)
- TUF root threshold: 3 of 5 root-role keys
- Root metadata expiry: 2025-02-19T08:04:32Z

Root 10 is used only as the out-of-band trust anchor. The verifier must authenticate each sequential root rotation (11, 12, …) with both the previous root authority and the new root's self-signature. It then checks expiry on the final trusted root before accepting timestamp, snapshot, targets, or the `trusted_root.json` target. An expired bootstrap is not accepted as the final operational root.

The runtime must never skip a missing root version or treat the latest downloaded root as trusted merely because it was fetched from the official CDN.
