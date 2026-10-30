---
name: coverage-gate
description: Enforce per-PR coverage deltas and fail builds on coverage regression. CI-integrable coverage gate.
version: 0.1.0
execution-mode: remedial
argument-hint: "[--threshold 80] [--delta -2] [--base main] [--report]"
category: dev-tools
status: candidate
---
# Coverage Gate Command

Enforce coverage thresholds on a PR or commit. Unlike `[coverage]` which
reports, `coverage-gate` gates — it exits non-zero when coverage regresses,
making it suitable for CI integration and pre-merge checks.

## When to Use

- In CI workflows as a required status check
- Before merging a PR to verify coverage didn't drop
- As a pre-push hook to catch coverage regressions early
- After `[test-gen]` to verify new tests actually cover the target code

## Usage

```bash
[coverage-gate]                          # Gate: overall coverage >= 80%
[coverage-gate] --threshold 90           # Gate: overall coverage >= 90%
[coverage-gate] --delta -2               # Gate: coverage didn't drop more than 2%
[coverage-gate] --base main              # Compare against main branch
[coverage-gate] --changed-only           # Gate only on files changed in this PR
[coverage-gate] --report                 # Generate coverage report artifact
[coverage-gate] --threshold 80 --delta -1 --changed-only  # Combined gates
```

## Execution

### Phase 1: Detect repo configuration

1. **Read coverage config** from pyproject.toml:
   ```bash
   python -c "
   import tomllib
   d = tomllib.load(open('pyproject.toml','rb'))
   cov = d.get('tool',{}).get('coverage',{}).get('run',{})
   print('source:', cov.get('source', ['.']))
   print('omit:', cov.get('omit', []))
   "
   ```

2. **Detect package name**:
   - src/ layout: `ls src/` to find the package directory
   - flat layout: use `source = ["."]` from config

3. **Determine base branch** (default: main):
   ```bash
   git rev-parse --verify main 2>/dev/null && echo "main" || echo "master"
   ```

### Phase 2: Run coverage

1. **Run pytest with coverage**:
   ```bash
   python -m pytest tests/ \
     --cov=<package> \
     --cov-report=term-missing \
     --cov-report=json:coverage.json \
     -q
   ```

2. **Parse coverage.json** for total coverage percentage:
   ```python
   import json
   with open('coverage.json') as f:
       data = json.load(f)
   total_coverage = data['totals']['percent_covered']
   ```

### Phase 3: Gate checks

Run each gate in order. Fail fast on first failure.

#### Gate 1: Absolute threshold (default: 80%)

```python
threshold = <from --threshold arg, default 80>
if total_coverage < threshold:
    FAIL(f"Coverage {total_coverage:.1f}% below threshold {threshold}%")
```

#### Gate 2: Delta gate (default: off, enable with --delta)

Compare current coverage against base branch:

```bash
# Get base branch coverage
git stash  # save current changes
git checkout <base>
python -m pytest tests/ --cov=<package> --cov-report=json:coverage-base.json -q
git checkout -
git stash pop  # restore current changes

# Compare
python -c "
import json
base = json.load(open('coverage-base.json'))['totals']['percent_covered']
current = json.load(open('coverage.json'))['totals']['percent_covered']
delta = current - base
max_drop = <from --delta arg>
if delta < max_drop:
    print(f'FAIL: Coverage dropped {abs(delta):.1f}% (max allowed drop: {abs(max_drop)}%)')
    exit(1)
else:
    print(f'PASS: Coverage delta {delta:+.1f}%')
"
```

#### Gate 3: Changed-files-only gate (enable with --changed-only)

Only gate on files changed in this PR:

```bash
CHANGED_FILES=$(git diff --name-only <base>...HEAD | grep '\.py$' | grep -v 'test_')
```

For each changed file, check if its coverage dropped below threshold:
```python
import json, subprocess
changed = subprocess.check_output(
    ['git', 'diff', '--name-only', base, 'HEAD']
).decode().splitlines()
changed_py = [f for f in changed if f.endswith('.py') and 'test_' not in f]

with open('coverage.json') as f:
    data = json.load(f)

for filepath in changed_py:
    if filepath in data['files']:
        file_cov = data['files'][filepath]['summary']['percent_covered']
        if file_cov < threshold:
            FAIL(f"{filepath}: {file_cov:.1f}% below threshold {threshold}%")
```

### Phase 4: Report

If `--report` is passed, generate a markdown report:

```markdown
# Coverage Gate Report

**Date**: <YYYY-MM-DD HH:MMZ>
**Base**: <base branch>
**Threshold**: <threshold>%
**Delta limit**: <delta or "off">

## Results

| Gate | Status | Detail |
|------|--------|--------|
| Absolute threshold | PASS/FAIL | XX.X% (threshold: XX%) |
| Delta | PASS/FAIL | +/-X.X% (limit: -X%) |
| Changed files | PASS/FAIL | N files checked |

## Per-file coverage (changed files only)

| File | Stmts | Miss | Cover | Status |
|------|-------|------|-------|--------|
| src/module.py | 120 | 15 | 87% | PASS |
| src/other.py | 80 | 25 | 69% | FAIL |

## Recommendation
<proceed with merge | fix coverage before merge>
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All gates passed |
| 1 | Absolute threshold gate failed |
| 2 | Delta gate failed |
| 3 | Changed-files gate failed |
| 4 | Coverage tool not available (pytest-cov not installed) |
| 5 | Base branch coverage unavailable |

## CI Integration

### GitHub Actions example

```yaml
- name: Coverage gate
  run: |
    python -m venv .venv
    .venv/bin/pip install -e ".[test]"
    .venv/bin/python -m pytest tests/ \
      --cov=<package> \
      --cov-report=term-missing \
      --cov-report=json \
      -q
    # Gate: fail if overall coverage < 80%
    .venv/bin/python -c "
    import json
    cov = json.load(open('coverage.json'))['totals']['percent_covered']
    threshold = 80
    if cov < threshold:
        print(f'::error::Coverage {cov:.1f}% below threshold {threshold}%')
        exit(1)
    print(f'::notice::Coverage {cov:.1f}% (threshold: {threshold}%)')
    "
```

## Constraints

- Requires `pytest-cov` installed (`pip install pytest-cov`)
- Delta gate requires a clean base branch checkout (stash + checkout + restore)
- Changed-files gate requires `git diff` against base — won't work on detached HEAD
- Does not fabricate coverage numbers — always runs real pytest
- Default threshold is 80% — adjust per repo with `--threshold`
- The `coverage.json` file should be in `.gitignore` — it's a build artifact

## Relationship to other skills

- `[coverage]`: Reports coverage but does NOT gate. Use for visibility.
- `[coverage-gate]`: Gates coverage — fails on regression. Use for enforcement.
- `[test-gen]`: Generates tests to fix coverage gaps found by either skill.
- `[test-trends]`: Tracks coverage over time across multiple runs.
