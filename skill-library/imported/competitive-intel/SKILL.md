---
name: competitive-intel
description: Research and compare competitors, alternatives, and market positioning.
version: 0.1.0
execution-mode: advisory
argument-hint: "\"COMPETITOR or CATEGORY\" (e.g., \"\"AI governance platforms\")"
category: hummbl-research
status: candidate
---
# Competitive Intelligence

Structured competitor and market research with source-backed findings.

## Execution

### 1. Identify the landscape
What category are we researching?
- Direct competitors (same product, same market)
- Indirect competitors (different product, same problem)
- Adjacent players (same technology, different market)
- Open-source alternatives

### 2. Research each player
For each competitor, capture:

| Field | What to Find |
|-------|-------------|
| **Name** | Company/project name |
| **URL** | Website + GitHub |
| **Funding** | Raised, investors, valuation |
| **Team** | Size, key people |
| **Product** | What they ship |
| **Pricing** | Free/paid/enterprise |
| **Differentiator** | Why customers choose them |
| **Weakness** | Where they fall short |
| **Overlap** | What's similar to us |
| **Threat level** | Low/Medium/High |

**Supadata scrape each competitor** for richer profiles:

```bash
export SUPADATA_API_KEY="$(cat ~/supadata\ api.txt | grep sd_)"

# Competitor homepage + positioning
python3 ~/bin/supadata.py scrape "https://competitor.com"

# Pricing page (often reveals target market + segmentation)
python3 ~/bin/supadata.py scrape "https://competitor.com/pricing"

# Changelog / release notes (reveals velocity + priorities)
python3 ~/bin/supadata.py scrape "https://competitor.com/changelog"
python3 ~/bin/supadata.py scrape "https://competitor.com/blog"

# Documentation sitemap (reveals feature surface area)
python3 ~/bin/supadata.py map "https://docs.competitor.com"

# If they have YouTube demos/keynotes — extract transcripts
python3 ~/bin/supadata.py transcript "https://youtube.com/watch?v=..." --text
python3 ~/bin/supadata.py metadata "https://youtube.com/watch?v=..."
```

**Credit budget**: ~5-8 credits per competitor for a thorough profile. Prioritize direct competitors over adjacent ones.

### 3. Position ourselves
**Standards references:** Any competitive positioning claim that cites a specific OWASP/NIST/ISO item number (e.g., "compliant with OWASP ASI-3" or "maps to NIST SP 800-218 §4.1") must be verified against the live document before recording. Fetch the canonical source URL, confirm the exact article/section number and title, and include the URL inline with the claim. Do not carry forward numbered references from prior research without re-verification.

Where do we fit?

```
             Enterprise ←→ Developer
                  ↑
            Governance-heavy
                  |
    [Your Org]  ←  our position
                  |
            Governance-light
                  ↓
```

### 4. Identify our moat
What do we have that's hard to replicate?
- Base120 mental model taxonomy (proprietary IP)
- Multi-agent bus coordination (battle-tested at 11K+ messages)
- IDP delegation tokens (unique to our stack)
- hummbl-governance daily briefing (unique workflow)

### 5. Persist findings
Save to `docs/research/competitor_landscape_<date>.md` and post discovery to CLP ledger.

## Output Format
```
Competitive Intel | <category>
═══════════════════════════════

## Landscape (N players found)
<2x2 or positioning map>

## Player Profiles
### <competitor 1>
<structured profile>

## Our Position
<where we fit, our moat, our gaps>

## Strategic Implications
- <what we should do differently>
- <what we should double down on>
- <what we should watch>

## Sources
<URLs with reliability ratings>

## Verification required
<Any standards item numbers cited above (OWASP/NIST/ISO/EU AI Act) — list each with canonical URL and exact section text confirming the number/name mapping. Leave blank if no standards items cited.>
```

## Base120 Context
- Primary: **SY16** (Ecosystem Strategy)
- Related: **P7** (Perspective Switching), **IN13** (Opportunity Cost), **P14** (Reference Class Framing)
