# CEOAI API Connector Registry

This first version provides a code-owned, read-only connector for Hacker News Search through the public Algolia API. It supports relevance search and date-sorted search without an API key.

Security boundary:
- Fixed HTTPS origin and fixed GET paths. Callers cannot provide URLs, hosts, methods, headers, cookies, credentials, or request bodies.
- Strict query allowlist, bounded page/hit counts, bounded timeout and response bytes.
- Redirects are rejected. Only JSON responses are parsed.
- Output is projected onto an allowlisted field set; upstream error bodies and unrecognized fields are not returned.
- Search results are untrusted reference data. The registry does not grant agent tools or permissions.

The registry is an internal module only. It is not wired to /api/chat or /v1/agents/run and makes no outbound request until an internal caller invokes execute(). The existing empty application tool registry and approval policy are unchanged.

The declarative-operation idea was reviewed alongside goodnight000/api-anything (MIT), but no runtime, learned site specification, cookie, credential, or captured request was copied.
