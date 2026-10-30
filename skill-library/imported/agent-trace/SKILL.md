---
name: agent-trace
description: Trace and debug agentic workflows by logging tool calls, decision points, and state transitions
version: 0.1.0
execution-mode: advisory
argument-hint: "[--agent <name>] [--session <id>] [--format json|dot|trace]"
category: fleet-ops
status: candidate
---
# agent-trace | Agent Workflow Tracer

## When to Use
- Debugging an agent that produced an unexpected result
- Analyzing a failed or looping agentic workflow
- Auditing decision points for compliance or review
- Profiling tool-call patterns for optimization

## Execution

### 1. Parse Arguments
- `--agent <name>`: filter traces to a specific agent (default all)
- `--session <id>`: filter to a specific session ID
- `--format json|dot|trace`: output format (default trace)

### 2. Collect Trace Events
- Read trace logs from `_state/traces/` or live agent instrumentation
- Capture events: tool call, tool result, LLM call, decision, state transition
- Record timestamp, agent, session, step index, and event payload

### 3. Reconstruct Workflow
- Order events by timestamp and step index
- Build a step-by-step timeline of the agent's execution
- Link tool calls to their results and LLM calls to their outputs
- Identify decision points where the agent chose a branch

### 4. Detect Anomalies
- Loops: repeated tool calls or identical LLM prompts (>3 repeats)
- Dead ends: tool calls with no subsequent state change
- Long latencies: steps exceeding 2x median duration
- Errors: failed tool calls or LLM refusals

### 5. Analyze State Transitions
- Map state machine transitions across the session
- Flag illegal or unexpected transitions
- Record context window usage at each step

### 6. Emit Trace
- Write trace to `_state/traces/<agent>_<session>.<format>`
- For DOT: generate a visual graph of the workflow
- For JSON: emit structured event list for programmatic analysis

## Output Format

```
agent-trace | agent=researcher session=s-4821 format=trace

## Session Summary
- Agent: researcher | Session: s-4821
- Steps: 18 | Duration: 42.3s | Tool calls: 7 | LLM calls: 6

## Workflow Timeline
| Step | Event        | Detail                    | Duration |
|------|--------------|---------------------------|----------|
| 1    | llm-call     | plan task                 | 1.2s     |
| 2    | tool-call    | web_search("GDPR fines")  | 3.4s     |
| 3    | tool-result  | 5 results returned        | 0.0s     |
| 4    | decision     | branch: summarize         | -        |
| 5    | llm-call     | generate summary          | 2.1s     |

## Anomalies
- LOOP: steps 8-10 repeated web_search 3x -> flagged
- LATENCY: step 12 took 8.2s (4x median) -> flagged

## State Transitions
planning -> searching -> analyzing -> summarizing -> done

## Verdict
PASS | 18 steps traced, 2 anomalies flagged for review
```

## Skill Chains
- After tracing -> `[debug-test]` to reproduce and fix flagged issues
- After tracing -> `[log-analyze]` to correlate with system logs
- Before tracing -> `[agent-audit]` to scope the audit requirements
