---
name: seo-audit
description: Review a website for technical SEO, indexability, metadata, content quality, structured data, internal linking, and AI-search discoverability. Use when asked to audit or diagnose a site.
category: seo-and-site-auditing
tags: [seo, technical-seo, indexability, structured-data, accessibility, site-audit]
risk: low
external_actions: false
---

# SEO Audit Skill

## Goal
Produce a prioritized, evidence-led SEO audit that separates confirmed findings from hypotheses and proposes testable fixes. This workflow does not claim changes were deployed or rankings will improve.

## Workflow
1. Confirm scope: target URL(s), language, country/market, device context if supplied, and objective. Do not assume access to Search Console, analytics, or server logs.
2. Inspect accessible pages with permitted public/read-only tools. Record final URL after redirects when observable, HTTP status when observable, title, meta description, canonical, robots directives, heading structure, internal links, image alt text, and visible content.
3. Separate evidence from inference. Every finding must include a URL and concise evidence, observed value, or reproducible check. Label untested items "not checked".
4. Check status/redirects, indexability, canonical consistency, sitemap/robots availability, mobile layout signals, broken internal links, duplicate titles, missing metadata, structured-data validity when markup is available, and basic accessibility.
5. Review content intent, page-topic match, unanswered user questions, thin/duplicated content, unsupported claims, and useful first-hand detail. Never invent search volumes, rankings, traffic, Core Web Vitals, or competitor metrics.
6. Review AI-search readiness: clear entity naming, concise factual answers, descriptive headings, attributable sources, consistent product facts, and valid structured data where appropriate. Do not promise inclusion in AI answers or ranking benefits from llms.txt.
7. Prioritize issues by impact (1–5), confidence (1–5), and effort (1–5), explaining the scores as internal estimates, not Google metrics.
8. Draft specific fixes and validation steps. Do not edit or publish production without explicit authorization.

## Output
- Scope and limitations
- Executive summary of confirmed facts
- Findings: priority, URL, evidence, issue, impact, confidence, proposed fix, validation
- Quick wins
- Items requiring Search Console, analytics, server access, or real device testing
- Acceptance checklist

## Safety and cost
Use public pages and already available free tools only. Respect terms, robots directives, rate limits, and privacy. Do not claim a test passed unless actually run. A proposed fix is not a deployed fix.
