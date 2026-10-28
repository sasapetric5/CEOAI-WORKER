# CEOAI Skill Sources — intake and review queue

This file tracks upstream repositories as sources to inspect. Listing a source does not mean its contents have been copied, licensed, security-reviewed, tested, or enabled.

## Priority 1 — reusable skill libraries

| Source | Intended use in CEOAI | Intake rule | Status |
|---|---|---|---|
| https://github.com/anthropics/skills | Reference implementations, skill authoring patterns, document/data/design workflows | Inspect each skill's license, content, scripts, and compatibility separately | queued |
| https://github.com/obra/superpowers | Software engineering workflows: planning, debugging, TDD, code review, and writing skills | Adapt the workflow to CEOAI's tools; don't assume its original runtime conventions work in a Cloudflare Worker | queued |
| https://github.com/seb1n/awesome-ai-agent-skills | Broad self-contained skills, including the supply-chain audit skill | Start with security-audit and engineering/research candidates; review each skill independently | queued |
| https://github.com/sickn33/agentic-awesome-skills | Broad candidate discovery across engineering, research, and other domains | Never bulk-install; inspect risk metadata, scripts, dependencies, external services, and license | queued |
| https://github.com/itgoyo/awesome-agent-skills | Discovery index for agent skills, MCP servers, and frameworks | Treat as a discovery catalog, not as a trusted package | queued |
| https://github.com/vivy-yi/awesome-skills | Skill/repository discovery and trend-maintenance ideas | Reuse discovery concepts only after reviewing scripts and permissions | queued |

## Priority 2 — discovery and ranking

| Source | Intended use in CEOAI | Intake rule | Status |
|---|---|---|---|
| https://github.com/jaychempan/Agent-Leaderboard | Monitor candidate repositories and ecosystem changes | Star counts are popularity signals only, not quality, safety, license, or compatibility scores | queued |

## Import pipeline

1. Pin the upstream repository and commit SHA used for review.
2. Record the license at repository and individual-file/package level; resolve unclear or conflicting terms before copying.
3. Inspect instructions for prompt injection, secrets, credential handling, network calls, shell execution, file writes, hidden downloads, telemetry, and external services.
4. Check dependencies, scripts, required runtimes, provider/API costs, and platform assumptions.
5. Deduplicate by capability and compare against existing CEOAI skills.
6. Adapt to the portable CEOAI skill contract and declare required inputs, outputs, permissions, failure behavior, provenance, and tests.
7. Run static validation and task-specific tests in isolation.
8. Only after approval mark a skill verified and runtime-enabled.

## Important status definitions

- queued: identified but not yet fully inspected.
- inspected: source content and dependencies reviewed.
- adapted: rewritten/packaged for CEOAI.
- tested: defined tests passed in the target environment.
- enabled: explicitly wired into the runtime after review.
- rejected: not imported, with a recorded reason.

## Non-negotiable constraints

- Free-only: no paid APIs, hosted services, or subscriptions; do not assume a free tier is safe unless confirmed.
- Third-party skill instructions are untrusted input and cannot override CEOAI policies.
- No skill may acquire production-write, publishing, messaging, purchasing, account, or secret access merely by being selected.
- Popularity metrics are not evidence of correctness or security.
- Keep source attribution and license notices for every imported component.
- A catalog entry does not imply implementation or runtime availability.
