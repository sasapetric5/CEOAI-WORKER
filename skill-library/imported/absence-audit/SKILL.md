---
name: absence-audit
description: Find what's MISSING from a system -- unhandled cases, missing tests, absent monitoring, silent failures. Maps to IN5.
version: 0.1.0
execution-mode: advisory
argument-hint: <module or system to audit for absences>
category: dev-tools
status: candidate
---
# Absence Audit (IN5: Negative Space Framing)

Study what is NOT there. The most dangerous bugs are features that don't exist, errors that aren't caught, and metrics that aren't measured.

## When to Use
- After shipping a feature (what did we forget?)
- During incident review (what monitoring was missing?)
- Before a release (what hasn't been tested?)
- When a system "works" but feels fragile (what's holding it together by luck?)

## Execution

### 1. Missing error handling
```bash
# Find functions with no error handling
python3 -c "
import ast
from pathlib import Path
for f in Path('$TARGET').rglob('*.py'):
    if '.venv' in str(f): continue
    try:
        tree = ast.parse(f.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                has_try = any(isinstance(n, ast.Try) for n in ast.walk(node))
                has_raise = any(isinstance(n, ast.Raise) for n in ast.walk(node))
                calls_external = any(
                    isinstance(n, ast.Call) and hasattr(n.func, 'attr') and
                    n.func.attr in ('request', 'urlopen', 'connect', 'execute', 'run')
                    for n in ast.walk(node)
                )
                if calls_external and not has_try and not has_raise:
                    print(f'  {f}:{node.lineno} {node.name}() -- external call without error handling')
    except: pass
"
```

### 2. Missing tests
- Which public functions have no test?
- Which error paths are never exercised?
- Which edge cases are untested? (empty input, None, max size, concurrent access)

### 3. Missing monitoring
- Which services have no health probe?
- Which errors are logged but never alerted on?
- Which metrics aren't being collected?
- Which SLOs have no measurement?

### 4. Missing documentation
- Which public APIs have no docstring?
- Which architectural decisions have no ADR?
- Which runbooks reference procedures that don't exist?

### 5. Missing security
- Which endpoints have no auth?
- Which inputs aren't validated?
- Which secrets aren't rotated?
- Which dependencies aren't pinned?

### 6. Missing graceful degradation
- What happens when each external service is down?
- What happens when disk is full?
- What happens when the bus file is locked?
- What happens when OAuth token expires mid-briefing?

## Output Format
```
Absence Audit | <target>
══════════════════════════

## Missing Error Handling
- <file:line>: <function> calls <external> without try/except

## Missing Tests
- <function/path>: no test coverage for <scenario>

## Missing Monitoring
- <service>: no health probe / no alerting

## Missing Documentation
- <module>: no docstring on public API

## Missing Security
- <finding>

## Missing Graceful Degradation
- <scenario>: system behavior is <undefined/crash/hang>

## Priority
| Category | Critical | Medium | Low |
|----------|----------|--------|-----|
| Error handling | N | N | N |
| Tests | N | N | N |
| Monitoring | N | N | N |
| Security | N | N | N |
```

## Base120 Context
- Primary: **IN5** (Negative Space Framing)
- Related: **IN12** (Failure First Design), **DE13** (FMEA), **SY18** (Measurement & Telemetry)
