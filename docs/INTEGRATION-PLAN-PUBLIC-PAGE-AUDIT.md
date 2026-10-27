# CEOAI public-page audit — integration plan

Status: design and test plan only. This document does not activate providers, alter Cloudflare settings, or deploy application behavior.

## Scope

Add a deterministic, bounded public HTML fetch and observation module that can later support SEO/GEO auditing. Keep it isolated from chat routing until security review and tests are complete.

## Required safeguards before production use

- Allow only HTTP/HTTPS and reject URL credentials, IP literals, localhost, internal hostnames, and nonstandard ports.
- Disable automatic redirects; validate every redirect target and cap redirect count.
- Enforce an overall timeout and a strict response-body byte limit while streaming.
- Accept only HTML/XHTML content types; return sanitized error codes, not remote response bodies.
- Extract only deterministic observations (title, description, canonical, robots meta, headings, image alt presence, JSON-LD validity/types, and link counts).
- Clearly distinguish measured observations from missing declarations and metrics that were not measured. Never fabricate Core Web Vitals, backlinks, rankings, traffic, or AI citations.
- Do not send page content to an AI provider automatically. AI interpretation must remain separately opt-in.

## Test plan

1. Reject invalid URLs, unsupported schemes, URL credentials, IP literals, localhost and internal hostnames.
2. Reject redirects to blocked destinations and excessive redirect chains.
3. Enforce timeout and body-size limits, including missing or dishonest Content-Length.
4. Reject non-HTML content types and non-success HTTP responses.
5. Verify deterministic extraction of title/meta/canonical/robots/headings/images/JSON-LD/links.
6. Verify no provider calls, secrets, writes to target sites, or invented performance metrics.
7. Run the new unit tests plus the complete existing `npm run verify` suite under Node.js 22 before wiring this module into the Worker.

## Known limitation

Hostname checks alone do not fully prevent DNS rebinding or a public hostname resolving to a private address. Production use requires a platform-enforced outbound egress policy or resolver-aware destination IP validation. Do not treat this prototype as a complete SSRF defense.

## Integration sequence

1. Add isolated module and mocked unit tests.
2. Run syntax checks and the complete existing regression suite.
3. Review SSRF, redirect, timeout, and parsing edge cases.
4. Integrate behind existing authentication and rate limits only after tests pass.
5. Keep AI disabled by default and require explicit approval before any production deployment or provider activation.
