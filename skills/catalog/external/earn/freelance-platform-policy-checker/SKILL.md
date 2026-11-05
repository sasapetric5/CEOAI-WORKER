---
name: freelance-platform-policy-checker
description: Checks official freelancer-platform rules and opportunity terms before a user invests time, applies, or accepts work.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Freelance Platform Policy Checker

## Purpose
Reduce avoidable account, payment, and eligibility surprises by summarizing official platform rules and the specific terms attached to an opportunity. It does not guarantee eligibility or provide legal advice.

## Workflow
1. Identify the exact platform, opportunity URL, work category, applicant country/residency where relevant, and intended payment method.
2. Use official platform policy pages and official opportunity terms first. Use CEOAI's existing guarded Spider for permitted public read-only access; do not create a second crawler.
3. Extract relevant rules for geographic availability, identity/KYC, age, fees, proposal credits, off-platform communication/payment, intellectual property, dispute handling, payout methods, thresholds, and timing.
4. Separate platform-wide rules from listing-specific requirements and from third-party payment-provider restrictions.
5. Quote only short necessary excerpts; provide source URLs and checked date.
6. Mark each requirement VERIFIED, NOT FOUND, CONFLICTING, or UNKNOWN. Do not infer country eligibility from a platform's general global marketing.
7. Produce a pre-application checklist and identify questions the user must confirm with the platform.

## Output
A concise rules matrix, official sources, fees and payout caveats, geographic/identity checks, risk flags, and a go/no-go/unknown recommendation with reasons.

## Safety and limits
- Search opportunities worldwide; do not restrict discovery to the user's current country.
- Use official sources for platform rules. If official evidence is unavailable, mark UNKNOWN rather than guessing.
- Never create accounts, submit applications, accept terms, contact support, move payments off-platform, or handle identity documents.
- Do not request passwords, cookies, API keys, wallet secrets, or KYC document uploads.
- No paid research services or APIs. No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. No upstream executable code or runtime dependency imported.
