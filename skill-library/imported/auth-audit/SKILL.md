---
name: auth-audit
description: Audit authentication and authorization patterns including token handling, session management, RBAC, OAuth flows, and credential storage
version: 0.1.0
execution-mode: advisory
argument-hint: "[PATH] [--focus tokens|sessions|rbac|oauth|all]"
status: tested
category: security
providers:
  required: [python]
---
# Auth Audit

Systematic review of authentication and authorization implementations. Examines token lifecycle, session management, role-based access control, OAuth flow correctness, and credential storage practices. Flags common vulnerabilities like token leakage, missing expiry, overprivileged roles, and insecure storage.

## When to Use
- Before shipping any auth-related feature
- After adding OAuth or token-based authentication
- Periodic security review of credential handling
- When onboarding a new integration that requires auth

## Execution
1. **Scan codebase** -- search PATH (or entire repo) for auth-related patterns:
   - Token creation, validation, refresh, and revocation
   - Session creation, expiry, and invalidation
   - Role/permission checks and RBAC enforcement
   - OAuth authorization code, token exchange, and refresh flows
   - Credential storage (env vars, files, keychains, hardcoded)
2. **Token handling** (if focus includes `tokens` or `all`):
   - Verify tokens have expiry and are validated on each request
   - Check for token leakage in logs, error messages, or URLs
   - Verify refresh token rotation
   - Check HMAC/signing key management
3. **Session management** (if focus includes `sessions` or `all`):
   - Verify session timeout and idle timeout
   - Check session invalidation on logout and password change
   - Flag session fixation vulnerabilities
4. **RBAC** (if focus includes `rbac` or `all`):
   - Map roles to permissions
   - Flag overprivileged default roles
   - Check for missing authorization checks on endpoints
5. **OAuth** (if focus includes `oauth` or `all`):
   - Verify state parameter usage (CSRF protection)
   - Check redirect URI validation
   - Verify PKCE usage for public clients
   - Check token storage after exchange
6. **Credential storage** (all scopes):
   - Verify no hardcoded secrets
   - Check .env files are gitignored
   - Verify Keychain/vault usage where appropriate
7. **Report** -- findings sorted by severity.

## Output Format
```
Auth Audit | path: {PATH} | focus: {focus}

## Summary
- Files scanned: {N}
- Auth patterns found: {N}
- Findings: {critical} critical, {high} high, {medium} medium

## Findings
### {SEVERITY}: {title}
- **File**: {path}:{line}
- **Pattern**: {what was found}
- **Risk**: {what could go wrong}
- **Fix**: {recommended remediation}

## Auth Architecture
- Token type: {JWT|HMAC|opaque|none}
- Session store: {description}
- RBAC model: {description}
- OAuth flows: {authorization_code|client_credentials|none}

## No further action needed | {N} findings require attention
```

## Skill Chains
| After this skill... | Consider... |
|--------------------|-------------|
| Vulnerabilities found | `[security-scan]` for broader code security review |
| Threat vectors identified | `[threat-model]` for systematic threat analysis |
| Credential issues found | `[env-audit]` to verify credential hygiene |
