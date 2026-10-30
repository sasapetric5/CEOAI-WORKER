---
name: coverage
description: Run pytest with coverage and report uncovered modules.
version: 0.2.0
status: tested
canonical_status: not_yet_global_canon
execution-mode: remedial
argument-hint: "[--changed | <module-path>]"
category: dev-tools
providers:
  required: [bash, python]
---
## Context Gathering

Before executing this skill, gather the following context:
- **Changed Python files**: Run `git diff --name-only main 2>/dev/null | grep "\.py$" | head -10 || echo "none"`

# Coverage Command

Run the test suite with coverage measurement and highlight modules below threshold.

## Usage

```bash
[coverage]              # Full coverage run
[coverage] --changed    # Coverage for files changed vs main only
[coverage] services/    # Coverage for a specific subpackage
```

## Execution

### Full run
```bash
python -m pytest tests/ --cov=your_package --cov-report=term-missing -q
```

### Changed files only
```bash
python -m pytest tests/ --cov=your_package --cov-report=term-missing -q
```
Then filter the report to only show files from `git diff --name-only main | grep "\.py$"`.

### Specific module
```bash
python -m pytest tests/ --cov=your_package.<module> --cov-report=term-missing -q
```

## Output Format

```
Coverage Report | <YYYY-MM-DD HH:MMZ>
══════════════════════════════════════

Overall: XX%

| Module | Stmts | Miss | Cover | Missing Lines |
|--------|-------|------|-------|---------------|
| services/scheduler.py | 120 | 15 | 87% | 45-52, 78 |
| ... | ... | ... | ... | ... |

## Below 80% Threshold
<list modules under 80% coverage with missing line ranges>

## Recommendations
<brief suggestions for improving coverage on the worst offenders>
```

## Constraints

- Always run actual pytest -- do not fabricate coverage numbers.
- The 80% threshold is a guideline, not a hard gate.
- If `--cov` is not available, suggest `pip install pytest-cov`.

## Promotion Receipt (v0.2.0 — 2026-06-24)

**Status**: `candidate` → `tested`
**Eval suite**: `eval/` (8 cases)
**Schema version**: `coverage_eval.v0.1.0`

### Self-test results (perfect run)
- coverage_accuracy: 1.0 (gate: gte 0.90) PASS
- uncovered_detection_rate: 1.0 (gate: gte 0.85) PASS
- false_uncovered_rate: 0.0 (gate: lte 0.10) PASS
- schema_validity: 1.0 (gate: gte 1.0, HARD) PASS
- critical_module_detection: 1.0 (gate: gte 1.0, HARD) PASS

### Residual issues
- Self-test uses ground-truth-as-actual; real pytest run needed
- No real-world coverage run validated yet
- Next target: STABLE (requires cross-agent runs + live sessions)
