---
name: diff-explain
description: Explain any git diff in plain English for non-technical stakeholders, PR reviewers, or onboarding context
version: 0.1.0
execution-mode: advisory
argument-hint: "[REF1..REF2] [--audience technical|business|onboarding] [--file PATH]"
category: dev-tools
status: candidate
---
# Diff Explain

Translate git diffs into clear, audience-appropriate explanations. Takes a ref range (commits, branches, tags) and produces a structured summary of what changed, why it matters, and what to watch for. Defaults to staged changes if no refs are provided.

## When to Use
- Explaining a PR to a non-technical reviewer or stakeholder
- Onboarding a new developer by walking through recent changes
- Creating release notes from a set of commits
- Understanding unfamiliar changes before reviewing or merging

## Execution
1. Parse `$ARGUMENTS` for ref range, audience, and optional file filter. Default audience is `technical`, default range is `HEAD~1..HEAD`.
2. Run `git diff $REF1..$REF2 [-- $FILE]` to get the raw diff. If range is empty, use `git diff --staged`.
3. Run `git log --oneline $REF1..$REF2` to get commit messages for context.
4. Categorize each changed file by change type: new feature, bug fix, refactor, config, test, docs.
5. For each category, write a plain-English summary appropriate to the audience:
   - **technical**: Include function names, module paths, and behavioral implications.
   - **business**: Focus on user-facing impact, risk, and business value.
   - **onboarding**: Explain the "why" behind conventions and patterns shown in the diff.
6. Flag any risky changes: API breaking changes, security-sensitive files, large deletions, dependency changes.
7. Produce the output in the structured format below.

## Output Format
```
Diff Explain | REF1..REF2 | audience

## Summary
{1-3 sentence overview of what changed}

## Changes by Category
### {Category}
- {file}: {plain-English explanation}

## Risk Flags
- {risk description} | Severity: {LOW|MEDIUM|HIGH}

## Reviewer Notes
{Audience-specific guidance for what to pay attention to}

Next action: {suggestion or "No further action needed"}
```

## Skill Chains
| After this skill... | Consider... |
|--------------------|-------------|
| Explaining a release diff | `[changelog-digest]` for stakeholder-ready summary |
| Explaining PR changes | `[pr-summary]` to create or update the PR description |
| Onboarding walkthrough | `[onboard-dev]` for full environment setup guide |
