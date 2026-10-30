---
name: daily-research
description: Daily evidence collection — find, evaluate, and ingest the best research into the knowledge system so claims are backed and builds are informed.
version: 0.1.0
execution-mode: advisory
argument-hint: "[focus \"TOPIC\"] [--depth quick|full] [--ingest]"
category: dev-tools
status: candidate
---
## Context Gathering

Before executing this skill, gather the following context:
- **Ledger entries**: Run `wc -l _state/cognition/ledger.jsonl 2>/dev/null || echo "0"`
- **Recent research docs**: Run `ls -1t docs/research/*.md 2>/dev/null | head -3 || echo "(none)"`
- **Last daily-research run**: Run `grep "daily-research" _state/coordination/messages.tsv 2>/dev/null | tail -1 | cut -f1 || echo "never"`

# Daily Research

Systematic evidence collection across domains that matter to your organization. Searches, evaluates, and ingests findings so that every claim in our code, docs, and pitch materials is backed by real evidence.

## When to Use
- Morning routine (after `[gm]`)
- Before writing specs, proposals, or pitch materials
- Before making architectural decisions
- When preparing for meetings with stakeholders or prospects
- Weekly deep dives on key domains

## Philosophy

**Evidence-first, not opinion-first.** Every finding must have:
- A source (URL, paper DOI, repo link, standard reference)
- A reliability rating (primary > secondary > forum > inference)
- A temporal marker (when was this true? still current?)
- A relevance tag (which your organization domain does this serve?)

## Domains

Research is organized by the domains your organization operates in:

| Domain | Why It Matters | Example Queries |
|--------|---------------|-----------------|
| **AI Governance** | Core positioning — our #1 differentiator | EU AI Act enforcement, NIST AI RMF updates, ISO 42001 changes |
| **Multi-Agent Systems** | Technical foundation of our platform | Agent coordination patterns, swarm architectures, MCP ecosystem |
| **AI Safety & Alignment** | Credibility with Anthropic, serious buyers | Hallucination mitigation, RLHF advances, constitutional AI |
| **Platform Engineering** | SRE expertise, operational credibility | Observability trends, IaC patterns, CI/CD evolution |
| **Cloud Compliance** | CCA-F certification, consulting pipeline | AWS/Azure/GCP compliance updates, FedRAMP changes, SOC 2 |
| **Agentic AI Market** | Competitive landscape, positioning | New agent frameworks, funding rounds, enterprise adoption |

## Supadata CLI

For direct web content and video transcript retrieval, use the local Supadata CLI:

```bash
# Set key (do once per session)
export SUPADATA_API_KEY="$(cat ~/supadata\ api.txt | grep sd_)"

# Scrape a web page to clean Markdown
python3 ~/bin/supadata.py scrape "https://example.com/article"

# Extract YouTube/TikTok/X video transcript with timestamps
python3 ~/bin/supadata.py transcript "https://youtube.com/watch?v=..."

# Fetch social media metadata (title, author, views, etc.)
python3 ~/bin/supadata.py metadata "https://youtube.com/watch?v=..."

# Discover all URLs on a site
python3 ~/bin/supadata.py map "https://example.com/docs"

# Crawl multiple pages from a site (cap at --max-pages)
python3 ~/bin/supadata.py crawl "https://example.com" --max-pages 10
```

**Free tier cap**: 100 credits/month. 1 scrape/transcript = 1 credit. Be selective.

## Execution

### quick (default — 5 minutes)
Scan headlines and recent publications. No deep reading.

1. **Web search** each active domain for news in the last 7 days:
   ```
   For each domain:
     WebSearch "<domain> 2026" filtered to last 7 days
     Evaluate top 3 results for novelty and relevance
     Record: title, URL, date, 1-line summary, reliability, relevance
   ```

2. **Supadata sweep** — fetch full content for top findings:
   ```
   For each high-promise URL from step 1:
     python3 ~/bin/supadata.py scrape "<url>"
     Skim for key claims, numbers, dates
   ```

3. **Check preprint servers** (if bioRxiv/medRxiv MCP available):
   - Search for AI safety, governance, or agent-related preprints from the last week

4. **Compile brief**:
   - Top 5 findings across all domains
   - Flag anything that changes our positioning or invalidates a claim
   - Note gaps: "we claim X but found no evidence" is valuable

### full (15-20 minutes)
Deep reading, cross-referencing, and ingestion.

1. Run `quick` scan first
2. **Deep dive** the top 3 findings:
   - Fetch the full source via Supadata scrape (or video transcript if it's a talk)
   - Extract specific claims with page/section references
   - Cross-reference against our existing docs and code
   - Rate confidence: does this confirm, contradict, or extend what we know?

3. **Video content sweep** (conference talks, keynotes, interviews):
   ```
   For each domain, check recent YouTube/TikTok/X content:
     python3 ~/bin/supadata.py transcript "<video-url>" --text
     Or for structured: python3 ~/bin/supadata.py metadata "<video-url>"
   ```

4. **Gap analysis**:
   - Read `PROJECTS/$REPO_NAME/BUSINESS.md` claims
   - Read recent pitch materials
   - For each claim that references industry data, verify it's still current
   - Flag stale citations (>6 months old without re-verification)

5. **Competitive scan**:
   - Check competitors (Credo AI, Holistic AI, Zenity, Microsoft AGT)
   - Scrape their blog, changelog, and docs via Supadata:
     ```
     python3 ~/bin/supadata.py scrape "https://credolabs.com/blog"
     python3 ~/bin/supadata.py map "https://docs.holisticai.com"  # discover what changed
     ```

### focus
Deep dive a single topic:
```
[daily-research] focus "EU AI Act hallucination logging requirements"
[daily-research] focus "MCP server ecosystem growth 2026"
[daily-research] focus "agent-to-agent delegation protocols"
```
Uses `--depth full` automatically. All search budget on one topic. Use Supadata to scrape primary sources,
download transcripts from relevant talks, and crawl documentation sites.

## Ingestion

When `--ingest` is passed (or findings are high-value), persist:

### 1. Cognitive Ledger (always)
```bash
source .venv/bin/activate
python -m hummbl_governance.cognition post \
  --type discovery \
  --agent "daily-research" \
  --scope "research" \
  --tags "<domain>,<subtopic>,evidence" \
  --content "<structured finding>"
```

### 2. Research docs (for substantial findings)
Save to `docs/research/evidence/YYYY-MM-DD_<topic>.md` with format:
```markdown
# Evidence: <Topic>
**Date**: YYYY-MM-DD
**Domain**: <domain>
**Confidence**: <0-100>%

## Finding
<what we learned>

## Sources
1. <url> — <what it says> (reliability: high/medium/low)

## Relevance to your organization
<how this affects our positioning, product, or claims>

## Action
<what to do with this — update a doc, inform a decision, nothing yet>
```

### 3. Bus post (always)
```bash
python3 -m hummbl_governance.bus.bus_writer "daily-research" all STATUS \
  "Daily research complete: <N> findings across <domains>. Top: <1-line summary of best finding>. Ingested: <N> to ledger, <N> to docs."
```

## Source Evaluation

Rate every source before ingesting:

| Tier | Source Type | Trust | Example |
|------|-----------|-------|---------|
| **S1** | Primary / official | High | NIST publication, EU Official Journal, Anthropic blog |
| **S2** | Peer-reviewed / code | High | arXiv with citations, open-source repo with tests |
| **S3** | Industry report | Medium | Gartner, Forrester, analyst reports |
| **S4** | News / journalism | Medium | TechCrunch, The Verge, Ars Technica |
| **S5** | Blog / secondary | Low-Medium | Personal blogs, dev.to, Medium (evaluate per-author) |
| **S6** | Forum / social | Low | Reddit, HN, Twitter (signal, not authority) |

**Hard rule**: Claims used in pitch materials or client-facing docs require S1-S3 sources only.

## Output Format
```
Daily Research | YYYY-MM-DD [quick|full|focus]
══════════════════════════════════════════════

## Top Findings

1. **<headline>** [<domain>]
   Source: <url> (S<tier>)
   Summary: <2-3 sentences>
   Relevance: <how it affects your organization>

2. ...

## Domain Coverage
- AI Governance: <covered/skipped> — <1-line if covered>
- Multi-Agent: <covered/skipped>
- AI Safety: <covered/skipped>
- Platform Eng: <covered/skipped>
- Compliance: <covered/skipped>
- Market: <covered/skipped>

## Stale Claims Found
- <claim in our docs> — last verified <date>, needs refresh

## Gaps
- <what we couldn't find evidence for>

## Ingested
- Ledger: <N> entries
- Docs: <N> files
- Bus: posted

## Next
<suggested focus topic for tomorrow based on gaps>
```

## Scheduling

This skill is designed to run daily. To automate:
```
[schedule] daily-research --cron "0 9 * * *" --prompt "[daily-research] --ingest"
```

Or manually as part of morning routine:
```
[gm] → [daily-research] → start work
```

## Chain
| After... | Consider... |
|----------|-------------|
| `[daily-research]` finding invalidates a claim | Update the doc, `[commit]` |
| `[daily-research]` finds competitor move | `[competitive-intel]` deep dive |
| `[daily-research]` finds regulatory change | `[legal-check]`, update compliance docs |
| `[daily-research]` gap in evidence | `[deep-research]` on that topic |
| Weekly accumulated findings | `[research-digest]` to summarize the week |

## Constraints
- Do NOT fabricate sources or round-number statistics
- Do NOT ingest unverified claims — flag them as `UNVERIFIED` in the ledger
- Do NOT modify code or production docs — only research artifacts
- Prefer fewer high-quality findings over many low-quality ones
- If a search returns nothing useful, say so — "no significant findings" is valid

## Base120 Context
- Primary: **IN1** (Evidence Hierarchy) — weight sources by reliability
- Related: **DE7** (Pareto 80/20) — focus on the vital few findings
- Related: **RE4** (Nested Story) — executive summary nesting into detail

## Skill Chains
- For free-tier inference for daily evidence synthesis -> `[reasoning-router]` (`route`)
