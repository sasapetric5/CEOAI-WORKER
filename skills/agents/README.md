# CEOAI Cross-App Agent Pack (20)

This is a portable catalog of 20 agent specifications for CEOAI V5.0, ContentCraft, AI Force, RankGeo, and Safe Automaton. It does **not** copy third-party frameworks or enable live agent execution.

## Files
- `registry.json`: canonical agent IDs, task domains, app mappings, operating procedure, hard limits, and activation status.
- `../../test/agent-pack-20.test.mjs`: registry policy and integrity checks.

## Status
All 20 agents are catalogued only. Runtime activation and production use are disabled. Three existing CEOAI skills are referenced for copywriting, SEO audit, and customer research to avoid needless duplication. Other profiles are native CEOAI specifications, not downloaded third-party implementations.

## Safe intake and rollout
1. Inspect upstream source and pin a revision before adopting any external implementation.
2. Review file/package license, dependencies, outbound network behavior, secrets handling, and free-tier/card requirements.
3. Adapt one agent at a time and add isolated tests.
4. Verify quota reservation is genuinely atomic before enabling provider calls.
5. Keep paid services and external actions disabled; require explicit approval for production changes.
