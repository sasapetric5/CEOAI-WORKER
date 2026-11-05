# Secret Guardian — defensive-only credential hygiene

## Purpose
Protect repositories and services controlled by the CEOAI owner from accidental credential exposure. This skill is defensive and restricted to explicitly owned or authorized assets.

## Allowed scope
- Scan the current trusted checkout and CI workspace using the repository's approved secret scanner.
- Review an explicitly authorized repository supplied by its owner, subject to a read-only, repository-scoped permission.
- Review CI findings, deployment configuration, secret-storage boundaries and remediation status.
- Produce a redacted report containing detector/provider family, repository, file path, commit reference and remediation state.

## Prohibited behavior
- Do not search arbitrary public repositories, Gists, package registries, container registries, paste sites or unrelated organizations for credentials.
- Do not retrieve, print, copy, export, pool or persist raw secret values.
- Do not verify a discovered credential by calling a provider API, inspecting balances, enumerating permissions or testing whether it is active.
- Do not use, exchange, rotate or apply credentials found in source material.
- Do not bypass source-platform rate limits, rotate tokens or proxies, or evade access controls.
- Do not write secrets to KV, memory, logs, reports, skill content, prompts or agent context.

## Safe workflow
1. Confirm the repository is owner-controlled or explicitly authorized. Unknown scope means stop.
2. Run `npm run check:secrets` in the trusted repository CI. Do not widen the scan to unrelated public targets.
3. Treat every suspected high-confidence finding as compromised. Record only redacted metadata; never include the value.
4. Recommend immediate revocation at the issuing provider, creation of a replacement credential, and storage only in the approved Cloudflare Secret binding.
5. Review provider usage/activity for unexpected use, then inspect commit history and deployment artifacts for exposure.
6. Remove the exposed value from current files and, when appropriate, coordinate Git-history cleanup. Rotation is required even after history cleanup.
7. Verify remediation with a fresh scanner run. Report what was actually tested and what remains outside coverage.

## CEOAI boundaries
- API keys remain in Cloudflare Secrets and are used only inside the provider adapter.
- Agents receive no environment object, secret-store binding or generic shell/network tool.
- Caller permissions, HMAC authentication, rate limits and tool allowlists remain code-owned.
- The current CI scanner checks tracked text files in this repository for high-confidence formats and suspicious assignments. It is not a complete scan of all historical commits, other repositories, public bundles, deployment logs or external registries.
- For complete Git-history and organization coverage, enable GitHub Secret Scanning and Push Protection where available and run a separately authorized scanner against each owned repository.

## Output contract
Report only: finding category, redacted repository/path/commit metadata, confidence, immediate remediation, and verification status. Never expose a credential or claim it is active.
