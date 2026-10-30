---
name: debug-test
description: Isolate and fix a failing test -- reproduce, diagnose root cause, patch, verify.
version: 0.1.0
execution-mode: remedial
argument-hint: "<test_path::test_name or -k \"pattern\">"
category: dev-tools
status: candidate
---
# Debug Test Command

Given a failing test, systematically isolate the root cause and fix it.

## Execution

### 1. Reproduce
```bash
source .venv/bin/activate
python -m pytest $TEST_PATH -v --tb=long
```

### 2. Classify the failure
- **Assertion error**: Expected value doesn't match actual
- **Import error**: Missing module or circular import
- **Fixture error**: Setup/teardown issue
- **Environment error**: Missing env var, port, file, or service
- **Timeout**: Test hangs or takes too long
- **Flaky**: Passes sometimes, fails sometimes (run 3x to confirm)

### 3. Isolate
- Run the test in isolation (single test, not full suite)
- Check if it fails only when other tests run first (ordering dependency)
- Check if it fails only with certain env vars set (e.g., BUS_SIGNING_SECRET)
- Check `setup_method`/`teardown_method` for missing cleanup (singleton pollution)

### 4. Common root causes in this codebase
- **BUS_SIGNING_SECRET in env**: Messages get wrapped in JSON signing envelope. Use `_unwrap_payload()` or clear the env var in test setup.
- **Kill switch singleton**: Tests that set kill switch state must call `reset_kill_switch()` in teardown.
- **Missing mock**: External service not mocked (configured gateway, GitHub, calendar, Signal).
- **Path resolution**: Tests running from wrong CWD. Check `_resolve_bus_path()`, `_resolve_ledger_path()`.
- **File permissions**: 0o660 hardening may conflict with test assertions.

### 5. Fix
- Prefer fixing the test over changing production code
- If production code has a bug, fix both and add a regression test
- Always verify the fix: run the single test, then run the full file

### 6. Verify no regressions
```bash
python -m pytest <test_file> -v --tb=short
```

## Output Format
```
Debug Test | <test_name>
═══════════════════════════

Failure: <error type>
Root cause: <1-2 sentences>
Fix: <what was changed>
Verification: <test_file> N/N passed
Residual risk: <if any>
```
