# CEOAI API Connector Registry

This first version provides a code-owned, read-only connector for Hacker News Search through the public Algolia API. It supports relevance search and date-sorted search without an API key.

Security boundary:
- Fixed HTTPS origin and fixed GET paths. Callers cannot provide URLs, hosts, methods, headers, cookies, credentials, or request bodies.
- Strict query allowlist, bounded page/hit counts, bounded timeout and response bytes.
- Redirects are rejected. Only JSON responses are parsed.
- Output is projected onto an allowlisted field set; upstream error bodies and unrecognized fields are not returned.
- Search results are untrusted reference data. The registry does not grant agent tools or permissions.

The registry is exposed to the specialist Supervisor through one bounded `hacker_news_search` tool. Only the `knowledge_retrieval_engineer` agent and its `hacker_news_public_research` skill declare this capability. The public ContentCraft/AI Force gateway continues to pass an empty `allowedToolIds` list, so it cannot invoke the connector. Trusted internal callers must explicitly pass `hacker_news_search` and approve tool execution. No outbound request occurs during system construction or unless the approved tool is actually selected and invoked.

The declarative-operation idea was reviewed alongside goodnight000/api-anything (MIT), but no runtime, learned site specification, cookie, credential, or captured request was copied.
