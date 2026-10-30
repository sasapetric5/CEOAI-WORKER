---
name: api-docs
description: Generate API documentation from FastAPI/Flask endpoints or Python function signatures
version: 0.1.0
execution-mode: advisory
argument-hint: "[source-path] [--format md|html]"
category: backend-infra
status: candidate
---
# [api-docs]

## When to Use
- Documenting a FastAPI or Flask API for consumers
- Generating reference docs from Python module public interfaces
- Updating API docs after endpoint changes
- Creating developer-facing documentation from code

## Execution

### Inputs
- **source-path** (optional): Path to API module or directory. Default: scan for `app`, `main`, `api` files
- **--format**: Output format -- `md` (default) or `html`

### Steps
1. Detect framework:
   - FastAPI: `@app.get`, `@app.post`, `@router.` decorators
   - Flask: `@app.route`, `@blueprint.route`
   - Plain Python: document public functions and classes
2. For each endpoint or public function:
   a. Extract route, HTTP method, function name
   b. Parse docstring (Google, NumPy, or Sphinx style)
   c. Extract parameter types from annotations and Pydantic models
   d. Extract response model and status codes
   e. Find example usage in test files if available
3. For Pydantic models referenced by endpoints:
   a. Extract fields, types, defaults, descriptions
   b. Generate example JSON payload
4. Organize by router/blueprint/module
5. Write to `docs/api/` directory (one file per router, plus index)

### Documented Elements
- All decorated endpoints (route, method, params, response)
- Request body schemas with example JSON
- Query/path/header parameters with types and defaults
- Authentication requirements (detected from dependencies)
- Error responses (from exception handlers)
- Public classes and functions (for library-style modules)

## Output Format

```
API Docs | dashboard/api/main.py
============================================================
Framework: FastAPI | Endpoints: 12 | Models: 8

## Sample Output

### GET /api/health
Health check endpoint.

**Response** `200 OK`
  {"status": "healthy", "probes": {...}, "timestamp": "..."}

### GET /api/bus/messages
Stream coordination bus messages via SSE.

**Query Parameters**
| Param | Type | Default | Description          |
|-------|------|---------|----------------------|
| since | str  | null    | ISO timestamp filter |
| type  | str  | null    | Message type filter  |
| limit | int  | 100     | Max messages         |

### POST /api/kill-switch
Set kill switch mode. Requires confirmation header.

**Request Body** (KillSwitchRequest)
  {"mode": "HALT_NONCRITICAL", "reason": "maintenance"}

Written to: docs/api/README.md (234 lines)
------------------------------------------------------------
Next: [readme-gen] --refresh (link API docs from README)
```

## Skill Chains
- After `[api-docs]` -> suggest `[readme-gen] --refresh` to link docs
- Before `[pr-summary]` with API changes -> run `[api-docs]` first
- Use with `[runbook-write]` for complete service documentation
