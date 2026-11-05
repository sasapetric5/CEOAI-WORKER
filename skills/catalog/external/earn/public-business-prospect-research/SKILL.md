---
name: public-business-prospect-research
description: Builds a small evidence-backed list of organizations whose publicly described needs may match a freelancer's service, without collecting personal contact data or initiating outreach.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Public Business Prospect Research

## Purpose
Find organizations with a plausible service need using public business-level evidence. This is research for human review, not automated lead generation or outreach.

## Workflow
1. Define the freelancer's service, target organization type, target geography (if any), exclusions, and maximum research sample.
2. Search public company websites, official directories, public tenders, and openly published project needs.
3. Record organization name, official website, public evidence of a relevant need, evidence date, source URL, and why the service may fit.
4. Prefer organization-level information. Do not compile personal emails, private phone numbers, personal profiles, or sensitive attributes.
5. Separate explicit requests for services from weak indicators or speculative fit.
6. Score evidence strength and service fit with a short explanation; do not fabricate budgets or buying intent.
7. Produce a shortlist and suggested research questions for the user to investigate independently.

## Output
A bounded organization shortlist, source-backed need signals, fit rationale, confidence, unknown budget/timing fields, and manual next steps.

## Safety and limits
- Worldwide by default; apply geographic filters only when the user requests them or an opportunity's official terms require them.
- Use only permitted public read-only sources through CEOAI's existing guarded Spider.
- No personal-data harvesting, enrichment, scraping of restricted pages, mass lead lists, spam, email discovery, or outreach.
- No account creation, CRM writes, paid APIs, or purchases.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Organization-level research only.
