---
name: agent-design
description: Design agentic workflows -- tool selection, loop structure, guardrails, memory, termination conditions
version: 0.1.0
execution-mode: advisory
argument-hint: "<agent_name> [--pattern react|plan-execute|reflexion] [--tools TOOL...]"
category: fleet-ops
status: candidate
---
# Agent Workflow Designer

Design complete agentic workflows from scratch. Covers the full agent architecture: reasoning pattern selection, tool definitions, loop structure, guardrails, memory management, error recovery, and termination conditions.

## When to Use
- Building a new AI agent and need to define its architecture
- Choosing between ReAct, Plan-and-Execute, Reflexion, or custom patterns
- Designing tool sets and permission boundaries for an agent
- Defining guardrails, cost limits, and termination conditions to prevent runaway agents

## Execution
1. Parse `$ARGUMENTS` for agent name, `--pattern` (default: `react`), and `--tools` list
2. Define the agent's purpose, input/output contract, and success criteria
3. Select and document the reasoning pattern with rationale:
   - ReAct: thought-action-observation loop (good for exploration)
   - Plan-and-Execute: upfront planning then step execution (good for multi-step tasks)
   - Reflexion: self-critique after each attempt (good for quality-sensitive tasks)
4. Design the tool set: what each tool does, input/output schema, error modes
5. Define guardrails: max iterations, cost ceiling, forbidden actions, output validators
6. Design memory architecture: short-term (conversation), working (scratchpad), long-term (persistent store)
7. Define termination conditions: success criteria, max retries, timeout, cost limit, human escalation triggers
8. Document error recovery: what happens when a tool fails, when the model hallucinates, when context overflows

## Output Format
```
Agent Design | {agent_name}
────────────────────────────────
Pattern: {react|plan-execute|reflexion}
Tools: {N} defined
Guardrails: {N} active

Architecture:
  Input -> {pattern loop} -> Output
  Memory: {short-term + working + long-term}
  Termination: {conditions}

Tools:
| Tool | Purpose | Input | Output | Error Mode |
|------|---------|-------|--------|------------|
| ...  | ...     | ...   | ...    | retry/skip/fail |

Guardrails:
- Max iterations: {N}
- Cost ceiling: ${N}
- Forbidden actions: {list}

Termination: {success criteria, failure modes, escalation path}
Action: {next steps or "No further action needed"}
```

## Skill Chains
| After this skill... | Consider... |
|--------------------|-------------|
| Agent designed | `[guardrail-design]` for detailed input/output safety filters |
| Tools defined | `[system-prompt]` to write the agent's system prompt |
| Multi-agent needed | `[swarm]` for coordinated multi-agent execution |
| inference tool for designed agents | `[reasoning-router]` (`python ~/bin/reasoning_router.py route`) |
