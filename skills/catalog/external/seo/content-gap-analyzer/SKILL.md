---
name: content-gap-analyzer
description: Compares a site's public content with stated audience questions and selected public competitors to identify evidence-backed content gaps.
version: 1.0.0
license: UNLICENSED
category: SEO
status: quarantined
source: CEOAI-authored
---

# Content Gap Analyzer

## Purpose
Find missing or weakly covered topics that matter to a defined audience. A gap is a research finding, not proof of search demand or a promise of ranking gains.

## Workflow
1. Confirm the site, products/services, audience, target markets/languages, business goals, and competitor set supplied or approved by the user.
2. Inventory a bounded sample of the site's public pages and relevant public competitor pages using CEOAI's existing guarded Spider.
3. Normalize topics and user questions; distinguish genuinely missing coverage from pages that exist under different wording.
4. Compare coverage by topic, intent, depth, freshness, evidence quality, and usefulness. Record exact URLs and checked dates.
5. Identify overlap/cannibalization, outdated claims, missing explanations, weak evidence, and unanswered user questions.
6. Recommend only gaps supported by the brief or observable evidence. Mark demand/volume UNKNOWN unless a reliable authorized source provides it.
7. Propose a prioritized editorial backlog with intended audience, page type, unique value, sources needed, and acceptance criteria.

## Deliverable
Provide scope and sample limits, topic coverage matrix, evidence-backed gaps, overlap risks, recommended briefs, confidence labels, and a retest plan. Distinguish observations from hypotheses.

## Boundaries
- Worldwide by default; target geographies come from the project brief, not inferred location.
- Public read-only research only through the existing guarded Spider. Respect robots.txt, terms, rate limits, and access controls.
- No paid tools/APIs, private or authenticated pages, credentials, scraping behind login, or personal-data lead collection.
- No website edits, CMS access, publishing, outreach, link placement, or other external side effects.
- Never fabricate search demand, competitor performance, rankings, or revenue. No runtime activation or tool grants.

## Provenance
Original CEOAI-authored workflow. No upstream code, copied skill text, package, or runtime dependency.


## Research transport
Use the existing guarded Spider for public read-only research; do not introduce a second crawler.
