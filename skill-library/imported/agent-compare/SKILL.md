---
provider-specific: true
name: agent-compare
description: Side-by-side comparison of agent outputs on identical tasks — quality, speed, cost, accuracy
version: 1.0.0
execution-mode: advisory
argument-hint: "<task-description> [--models claude-sonnet-4-20250514,claude-opus-4-20250514] [--runs 1]"
category: fleet-ops
status: candidate
---
# Agent Compare | `$ARGUMENTS`

Dispatch the same prompt to multiple models or agent configurations and compare results on a structured rubric.

## Context Gathering

Before executing this skill, gather the following context:
- Run `which claude 2>/dev/null && claude --version 2>&1 | head -1 || echo "claude CLI not found"`
- **!echo "Available models**: Run `claude-sonnet-4-20250514, claude-opus-4-20250514, claude-haiku-3-5-20241022"`

## Procedure

Parse `$ARGUMENTS` for:
- **task**: The prompt or task description (required)
- **models**: Comma-separated model list (default: `claude-sonnet-4-20250514,claude-opus-4-20250514`)
- **runs**: Number of runs per model for consistency check (default: 1)

### Step 1 — Prepare the Task

```bash
TASK="<user-provided task>"
MODELS="${MODELS:-claude-sonnet-4-20250514,claude-opus-4-20250514}"
RUNS="${RUNS:-1}"
OUTDIR="/tmp/agent-compare-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUTDIR"

echo "Task: $TASK"
echo "Models: $MODELS"
echo "Runs per model: $RUNS"
echo "Output: $OUTDIR"
```

### Step 2 — Dispatch to Each Model

For each model, run the same prompt via `claude -p`:

```bash
IFS=',' read -ra MODEL_LIST <<< "$MODELS"

for model in "${MODEL_LIST[@]}"; do
    for run in $(seq 1 "$RUNS"); do
        OUTFILE="$OUTDIR/${model}_run${run}.txt"
        TIMEFILE="$OUTDIR/${model}_run${run}.time"

        echo "--- Dispatching to $model (run $run) ---"

        START=$(python3 -c "import time; print(time.time())")

        claude -p "$TASK" --model "$model" --max-turns 1 \
            > "$OUTFILE" 2>"$OUTDIR/${model}_run${run}.err"

        END=$(python3 -c "import time; print(time.time())")
        ELAPSED=$(python3 -c "print(f'{$END - $START:.1f}')")
        echo "$ELAPSED" > "$TIMEFILE"

        echo "  Done in ${ELAPSED}s -- $(wc -c < "$OUTFILE" | tr -d ' ') bytes"
    done
done
```

### Step 3 — Collect Metrics

```bash
python3 << 'METRICS_INNER'
import os, glob

outdir = os.environ.get("OUTDIR", "/tmp/agent-compare-latest")

results = []
for outfile in sorted(glob.glob(f"{outdir}/*_run*.txt")):
    basename = os.path.basename(outfile)
    model = basename.rsplit("_run", 1)[0]
    run = basename.rsplit("_run", 1)[1].replace(".txt", "")

    with open(outfile) as f:
        content = f.read()

    timefile = outfile.replace(".txt", ".time")
    elapsed = float(open(timefile).read().strip()) if os.path.exists(timefile) else 0

    errfile = outfile.replace(".txt", ".err")
    errors = open(errfile).read().strip() if os.path.exists(errfile) else ""

    results.append({
        "model": model, "run": run, "elapsed_s": elapsed,
        "output_bytes": len(content), "word_count": len(content.split()),
        "line_count": content.count("\n"), "has_error": bool(errors),
    })

print(f"\n{'Model':<45} {'Run':>3} {'Time':>6} {'Words':>6} {'Lines':>6} {'Bytes':>7}")
print("-" * 80)
for r in results:
    flag = " ERR" if r["has_error"] else ""
    print(f"{r['model']:<45} {r['run']:>3} {r['elapsed_s']:>5.1f}s {r['word_count']:>6} {r['line_count']:>6} {r['output_bytes']:>7}{flag}")
METRICS_INNER
```

### Step 4 — Score on Rubric

Review each output and score on 5 dimensions (1-5 scale each, 25 max):

| Dimension     | Definition                                          |
|---------------|-----------------------------------------------------|
| Accuracy      | Factual correctness, no hallucinations              |
| Completeness  | Covers all aspects of the task                      |
| Format        | Proper structure, markdown, code blocks as needed   |
| Conciseness   | No unnecessary verbosity, padding, or hedging       |
| Actionability | Clear next steps, directly usable output            |

Read each output file, then fill in scores:

```bash
# Read outputs for comparison
for f in "$OUTDIR"/*_run*.txt; do
    echo "=== $(basename "$f") ==="
    head -50 "$f"
    echo "..."
    echo ""
done
```

### Step 5 — Cost Estimation

```bash
python3 << 'COST_INNER'
import os, glob

# Approximate costs per 1M tokens (2026-03 pricing)
COSTS = {
    "claude-opus-4-20250514":    {"input": 15.00, "output": 75.00},
    "claude-sonnet-4-20250514":  {"input": 3.00,  "output": 15.00},
    "claude-haiku-3-5-20241022": {"input": 0.80,  "output": 4.00},
}

outdir = os.environ.get("OUTDIR", "/tmp/agent-compare-latest")

print("\nCost Estimates (approximate):")
print(f"{'Model':<45} {'Output Tokens':>13} {'Est. Cost':>10}")
print("-" * 72)

for outfile in sorted(glob.glob(f"{outdir}/*_run*.txt")):
    basename = os.path.basename(outfile)
    model_key = basename.rsplit("_run", 1)[0]

    with open(outfile) as f:
        content = f.read()

    output_tokens = len(content) / 4  # rough estimate
    input_tokens = 500  # approximate prompt

    matched = False
    for cost_key, rates in COSTS.items():
        if cost_key in model_key:
            input_cost = (input_tokens / 1_000_000) * rates["input"]
            output_cost = (output_tokens / 1_000_000) * rates["output"]
            total = input_cost + output_cost
            print(f"{model_key:<45} {output_tokens:>10.0f}    ${total:>.4f}")
            matched = True
            break
    if not matched:
        print(f"{model_key:<45} {output_tokens:>10.0f}    unknown")
COST_INNER
```

## Output Format

```
Agent Compare | <task-summary> | <date>
=======================================

Task: <first 100 chars of prompt>
Models: <model-a>, <model-b>
Runs: N per model

Performance:
  <model-a>: X.Xs, N words, ~$0.XXXX
  <model-b>: X.Xs, N words, ~$0.XXXX

| Dimension     | <Model A> | <Model B> | Winner   |
|---------------|-----------|-----------|----------|
| Accuracy      |   X/5     |   X/5     | <winner> |
| Completeness  |   X/5     |   X/5     | <winner> |
| Format        |   X/5     |   X/5     | <winner> |
| Conciseness   |   X/5     |   X/5     | <winner> |
| Actionability |   X/5     |   X/5     | <winner> |
| TOTAL         |   X/25    |   X/25    | <winner> |

Recommendation: <model> for this task type
  Rationale: <why -- e.g., better accuracy at lower cost>

Outputs: <OUTDIR path>

Next action: <use winning model | test more tasks | adjust prompt>
```

## Skill Chains
- Before: `[prompt-lab]` (optimize the prompt first), `[token-estimate]` (predict costs)
- After: `[decision-log]` (record model choice), `[model-router]` (update routing rules), `[cost-status]` (check budget impact)
