---
name: agent-guardrail
description: Configure and test agent guardrails for input/output validation, tool-use constraints, and safety boundaries
version: 0.1.0
execution-mode: advisory
argument-hint: "[--agent <name>] [--type input|output|tool|safety] [--test]"
category: security
status: candidate
---
# agent-guardrail | Agent Guardrail Configurator

## When to Use
- Hardening an agent before production deployment
- Adding safety boundaries to prevent harmful or out-of-scope actions
- Validating that existing guardrails resist adversarial prompts
- Constraining tool use to approved operations and parameters

## Execution

### 1. Parse Arguments
- `--agent <name>`: target agent to configure (default all)
- `--type input|output|tool|safety`: guardrail category (default all)
- `--test`: run adversarial test suite after configuration

### 2. Configure Input Guardrails
- Prompt injection detection: pattern + classifier screening
- Topic filtering: reject out-of-scope requests
- Length and rate limits: cap input tokens and requests per minute
- PII scrubbing on inbound user messages

### 3. Configure Output Guardrails
- Content filtering: toxicity, self-harm, and policy violation classifiers
- Format validation: schema check on structured outputs
- PII redaction on outbound responses
- Refusal templates for blocked content

### 4. Configure Tool Guardrails
- Allowlist: permitted tools and parameter ranges
- Rate limiting: max tool calls per turn and per session
- Confirmation gates for destructive or irreversible operations
- Sandboxing: network and filesystem access boundaries

### 5. Configure Safety Boundaries
- Cost and token caps per session
- Loop detection: abort after N repeated tool calls
- Escalation path: hand off to human on safety triggers
- Audit logging: record all guardrail interventions

### 6. Run Test Suite (if --test)
- Execute adversarial prompt set from `_state/guardrails/tests/`
- Record pass/fail per test case and guardrail triggered
- Flag any bypass for immediate remediation

### 7. Emit Guardrail Config
- Write config to `_state/guardrails/<agent>.config.yaml`
- Write test results to `_state/guardrails/<agent>.test.md`

## Output Format

```
agent-guardrail | agent=researcher type=all test=true

## Configuration
| Category | Rules | Status |
|----------|-------|--------|
| input    | 6     | active |
| output   | 4     | active |
| tool     | 5     | active |
| safety   | 3     | active |

## Test Results
| Test ID   | Category | Result | Guardrail Triggered |
|-----------|----------|--------|---------------------|
| INJ-001   | input    | PASS   | prompt-injection    |
| TOX-003   | output   | PASS   | toxicity-filter     |
| TOOL-002  | tool     | PASS   | allowlist           |
| LOOP-001  | safety   | PASS   | loop-detection      |

## Summary
- Tests run: 24 | Passed: 23 | Failed: 1 | Bypasses: 0

## Verdict
PASS | 18 guardrails active, 23/24 tests passed, 1 failure flagged
```

## Skill Chains
- After configuring -> `[guardrail-design]` to refine guardrail architecture
- After configuring -> `[redteam]` to run advanced adversarial tests
- Before configuring -> `[agent-design]` to understand agent behavior
