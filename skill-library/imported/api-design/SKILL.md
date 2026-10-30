---
name: api-design
description: Design REST/HTTP APIs with consistent patterns -- endpoints, errors, pagination, auth.
version: 0.1.0
execution-mode: advisory
argument-hint: "\"API_NAME or RESOURCE\" (e.g., \"governance API\", \"agent registry API\")"
category: backend-infra
status: candidate
---
# API Design

Design consistent HTTP APIs following REST conventions and our project patterns.

## Execution

### 1. Define resources
What are the nouns? Map them to endpoints:

```
/api/v1/agents          GET (list), POST (create)
/api/v1/agents/:id      GET (detail), PATCH (update), DELETE
/api/v1/agents/:id/bus  GET (agent's bus messages)
```

### 2. Apply conventions

| Convention | Pattern |
|-----------|---------|
| **Versioning** | `/api/v1/` prefix |
| **Naming** | Plural nouns, kebab-case (`[bus-messages]`, not `[busMessages]`) |
| **Filtering** | Query params: `?type=STATUS&since=2026-03-16` |
| **Pagination** | `?limit=20&offset=0`, return `total` in response |
| **Sorting** | `?sort=-created_at` (prefix `-` for descending) |
| **Errors** | `{"error": {"code": "NOT_FOUND", "message": "Agent not found"}}` |
| **Auth** | Bearer token in `Authorization` header |
| **Content-Type** | `application/json` always |

### 3. Define error codes

| HTTP Status | When | Error Code |
|-------------|------|-----------|
| 400 | Bad request body/params | `VALIDATION_ERROR` |
| 401 | Missing/invalid auth | `UNAUTHORIZED` |
| 403 | Authenticated but not allowed | `FORBIDDEN` |
| 404 | Resource not found | `NOT_FOUND` |
| 409 | Conflict (e.g., duplicate) | `CONFLICT` |
| 422 | Valid JSON but invalid semantics | `UNPROCESSABLE` |
| 429 | Rate limited | `RATE_LIMITED` |
| 500 | Internal error | `INTERNAL_ERROR` |

### 4. Design for our stack
- Stdlib only: use `http.server` or document as FastAPI (dashboard only)
- JSON schemas from `contracts/` are the source of truth
- IDP delegation tokens for auth where applicable
- Circuit breaker wrapping for external calls

### 5. Write OpenAPI stub (optional)
```yaml
openapi: 3.0.0
info:
  title: <API Name>
  version: 0.1.0
paths:
  /api/v1/<resource>:
    get:
      summary: List <resources>
      parameters:
        - name: limit
          in: query
          schema: { type: integer, default: 20 }
```

## Output Format
```
API Design | <name>
══════════════════════

## Resources
<endpoint table>

## Authentication
<auth mechanism>

## Example Requests
<curl examples for key operations>

## Error Handling
<error code table>

## Schema References
<which contracts/ schemas apply>
```

## Base120 Context
- Primary: **CO9** (Interface Contracts)
- Related: **SY12** (Protocol Standards), **CO8** (Layered Abstraction)
