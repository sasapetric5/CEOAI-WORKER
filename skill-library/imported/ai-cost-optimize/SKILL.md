---
name: ai-cost-optimize
description: Reduce AI API costs through caching, batching, model downsizing, prompt compression, and response truncation strategies
version: 0.1.0
execution-mode: advisory
argument-hint: "[--action audit|recommend|implement] [--target-reduction PCT]"
category: fleet-ops
status: candidate
---
# AI Cost Optimize

Analyze current AI API spend and identify concrete cost reduction opportunities. Covers caching strategies, request batching, model tier downsizing, prompt compression, and response truncation -- each with estimated savings and implementation effort.

## When to Use
- API costs are climbing and you need to identify savings levers
- Before scaling up usage of an LLM-powered feature
- When optimizing prompt engineering for cost efficiency
- After a billing surprise or budget overshoot

## Execution
1. **Audit current spend** -- pull cost data from costs.db, environment, or user-provided billing export. Break down by model, endpoint, and feature.
2. **Identify cost drivers** -- rank by total spend: which models, which prompts, which call patterns dominate.
3. **Generate recommendations** -- for each driver, evaluate:
   - Caching: can responses be cached (semantic or exact match)?
   - Batching: can requests be grouped to reduce overhead?
   - Model downsizing: can a cheaper model handle this task at acceptable quality?
   - Prompt compression: can the prompt be shortened without losing output quality?
   - Response truncation: can max_tokens be reduced?
4. **Estimate savings** -- for each recommendation, calculate expected cost reduction as percentage and absolute amount.
5. **Implement** (if `--action implement`) -- apply the approved changes, verify output quality is maintained.

## Output Format
```
AI Cost Optimize | {action} | target: {target-reduction}%

## Current Spend Profile
| Model | Calls/day | Avg tokens | Daily cost | % of total |
|-------|-----------|------------|------------|------------|

## Recommendations
### 1. {Recommendation title}
- **Lever**: {caching|batching|downsizing|compression|truncation}
- **Estimated savings**: {PCT}% (${amount}/mo)
- **Effort**: {low|medium|high}
- **Risk**: {quality impact assessment}

## Summary
- Total potential savings: {PCT}% (${amount}/mo)
- Recommended first action: {description}
```

## Skill Chains
| After this skill... | Consider... |
|--------------------|-------------|
| Cost audit complete | `[cost-status]` to verify baseline spend data |
| Model downsizing recommended | `[model-router]` to configure tier routing |
| Prompt compression identified | `[token-estimate]` to validate reduced token counts |
| Cloudflare Neuron spend tracked | `[usage-monitor]` to check Neuron consumption via `python ~/bin/usage_monitor.py status` |
| AI Gateway caching recommended | `[stream-inference]` to test caching via `--use-gateway` flag (`python ~/bin/stream_test.py <model> --prompt "test" --use-gateway`) |
