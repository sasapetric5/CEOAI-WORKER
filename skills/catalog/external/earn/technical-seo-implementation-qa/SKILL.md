---
name: technical-seo-implementation-qa
description: Verifies a proposed technical SEO change against documented requirements, crawl evidence, and regression checks.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Technical SEO Implementation QA

## Purpose
Offer a quality-assurance checklist for technical SEO work delivered to a client.

## Workflow
1. Capture the requested change, affected URLs, expected behavior, and client acceptance criteria.
2. Establish a baseline from authorized public crawl evidence or client-provided exports.
3. Check relevant items such as status codes, canonical targets, robots directives, sitemap inclusion, redirects, metadata, structured data, and internal links.
4. Validate structured data syntax and compare declared content with visible page content; do not invent schema properties.
5. Check mobile and desktop templates and identify unintended noindex, blocked assets, redirect chains, or broken links.
6. Record each finding with URL, evidence, expected state, observed state, and severity.
7. Produce a regression checklist for after deployment; do not deploy or claim changes were applied.

## Output
Acceptance matrix, URL-level findings, severity-ranked defects, evidence references, and post-release regression plan.

## Safety and limits
- Use public read-only evidence or client-authorized exports.
- Do not alter robots.txt, redirects, metadata, DNS, or production code.
- Do not promise search ranking outcomes.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. QA and reporting only.
