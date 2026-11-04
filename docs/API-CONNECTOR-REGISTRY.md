# CEOAI API Connector Registry

This first version provides a code-owned, read-only connector for Hacker News Search through the public Algolia API. It supports relevance search and date-sorted search without an API key.

Security boundary:
- Fixed HTTPS origin and fixed GET paths. Callers cannot provide URLs, hosts, methods, headers, cookies, credentials, or request bodies.
- Strict query allowlist, bounded page/hit counts, bounded timeout and response bytes.
- Redirects are rejected. Only JSON responses are parsed.
- Output is projected onto an allowlisted field set; upstream error bodies and unrecognized fields are not returned.
- Search results are untrusted reference data. The registry does not grant agent tools or permissions.

The registry is available through a separate internal research-agent composition, which exposes one bounded `hacker_news_search` tool to a dedicated research specialist and its research skill. The public ContentCraft/AI Force gateway is unchanged and continues to use its existing empty tool registry. Trusted internal callers must explicitly use the research composition, pass `hacker_news_search` in `allowedToolIds`, and approve tool execution. No outbound request occurs during system construction or unless the approved tool is actually selected and invoked.

The declarative-operation idea was reviewed alongside goodnight000/api-anything (MIT), but no runtime, learned site specification, cookie, credential, or captured request was copied.
