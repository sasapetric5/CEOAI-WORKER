---
name: freelance-competitor-research
description: Produces evidence-backed competitor and market research reports that can be offered as a freelance deliverable.
version: 1.0.0
license: MIT
category: FREELANCE
status: quarantined
source: https://github.com/ertugrulakben/cashclaw
source_ref: ff30cb38ba6466d8c68d277a14bdee6c2aa1b06d
---

# Freelance Competitor Research

## Purpose
Prepare a professional competitor-research deliverable using verifiable public information. This can support a freelance service, but does not guarantee client demand or earnings.

## Brief
Collect the client's product/service, public website, target geography, audience, known competitors, and research priorities. If the client's offer is unclear, ask before comparing.

## Research method
Use only public, accessible sources through CEOAI's existing guarded Spider:
- official home, product, feature, pricing, documentation, changelog, and public case-study pages
- public GitHub repositories and release notes
- public review pages where access is permitted
- public press releases and job listings

Do not access accounts, private communities, paywalled content, personal profiles, or pages requiring session cookies. Do not use paid data providers or paid SEO tools.

For each company, collect observable facts: product and audience; features and integrations; current public pricing, currency, billing basis, and date checked; stated positioning; public customer/review evidence with source and sample size; and evidence-backed strengths, weaknesses, opportunities, and threats.

Mark unavailable data NOT PUBLICLY AVAILABLE. Mark estimates and inferences explicitly. Never invent revenue, funding, employee counts, ratings, customer numbers, or market share.

## Deliverable
Create a Markdown report with executive summary and research date; company profiles and official source links; feature comparison matrix; pricing comparison with currency and checked date; evidence-backed SWOT; positioning map if evidence is sufficient; actionable recommendations tied to findings; and methodology, source list, limitations, and confidence labels.

A service offer may define Basic/Standard/Extended scope, turnaround estimate, revisions, and acceptance criteria. Do not invent a market price or promise client outcomes; the user sets pricing after assessing effort, local tax rules, and platform fees.

## Quality controls
- Every material claim needs a source URL and date.
- Verify pricing on the official vendor page; directories are secondary evidence.
- Distinguish fact, inference, and recommendation.
- Do not reproduce copyrighted competitor content; summarize and quote only when necessary and brief.
- Do not collect personal contact details or build personal lead lists.
- Do not claim to have visited a page if it was not fetched.

## Safety boundaries
Research and draft only. No outreach, email, messaging, proposals, account creation, publication, website edits, tracking installation, or client contact. No paid APIs, subscriptions, advertising spend, or external write operations. All external side effects require separate explicit user approval and app-level permission checks.

## Provenance and limitations
Adapted from the MIT-licensed CashClaw competitor-analyzer skill. CashClaw CLI installation, npm dependency, fixed USD package prices, and claims about service revenue were removed. No CashClaw runtime or package dependency is imported.
