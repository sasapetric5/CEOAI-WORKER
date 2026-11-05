# CEOAI Application Integration Contract v1

Status: reserved design contract; does not grant runtime access.

## Application identities

| App | appId | Registry state | Agent quota | Model-call ceiling | Spider |
|---|---|---:|---:|---:|---:|
| ContentCraft | `CONTENTCRAFT-APP` | enabled | 2 agents | 3 per task | granted by current policy |
| AI Force | `AIFORCE-APP` | enabled | 3 agents | 4 per task | denied |
| RankGeo | `RANKGEO-APP` | reserved / disabled | 0 | 0 | denied |

RankGeo is a registry reservation only. Do not add `RANKGEO-APP` to `HMAC_ALLOWED_APPS`, do not create its application secret, do not issue credentials, and do not enable any capability or quota until a separate integration approval.

## Authenticated agent API

- Method/path: `POST /v1/agents/run`
- Content type: `application/json`
- Required headers: `X-App-Id`, `X-Timestamp`, `X-Nonce`, `X-Signature`
- Signature: HMAC-SHA256 over newline-separated `POST`, request path plus query, Unix timestamp, nonce, and lowercase hex SHA-256 digest of the exact raw request body.
- Nonce replay protection is mandatory through the Security Durable Object. Authentication fails closed when it is unavailable.
- Request body (unknown properties rejected):

```json
{
  "task": "string (1..2000 characters)",
  "input": {},
  "limit": 1
}
```

- `input` must be a JSON object no larger than 4,000 encoded bytes.
- `limit` is optional and cannot exceed the app's registered `maxAgents`.
- Request body maximum: 8 KiB.

## Response contract

Success (HTTP 200):
```json
{
  "success": true,
  "reply": "string",
  "agents": [],
  "partial": false,
  "modelUsage": {},
  "researchUsed": false,
  "researchSource": null
}
```

Errors use `success: false` and a stable `code`. Relevant access failures:
- `401 UNAUTHORIZED`: invalid HMAC, timestamp, or nonce.
- `403 APP_NOT_ENABLED`: app is not enabled in the CEOAI registry.
- `403 CAPABILITY_NOT_GRANTED`: requested Spider capability is not granted.
- `429 RATE_LIMITED`: per-app request limit reached.
- `503 RATE_LIMITER_UNAVAILABLE` / `AUTH_UNAVAILABLE`: required security service unavailable.

## Isolation and activation rules

- App identity comes only from the verified signed `X-App-Id` header, never from JSON input.
- Rate-limit namespaces and Spider job namespaces must include the authenticated appId.
- Memory/session data must not be shared across app identities.
- Spider requires a separate explicit per-app grant; AI Force remains denied.
- RankGeo activation requires a future reviewed change to registry state, quotas, capabilities, HMAC allowlist/secrets, and integration tests. This document alone grants no access.
