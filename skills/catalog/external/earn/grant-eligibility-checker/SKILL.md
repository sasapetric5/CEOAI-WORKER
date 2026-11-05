---
name: grant-eligibility-checker
description: Discovers grant and subsidy calls worldwide, then checks eligibility against the exact jurisdiction and official call rules.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: https://github.com/sasapetric5/CEOAI-WORKER
source_ref: internal-adaptation-2026-11-05
---

# Grant and Subsidy Eligibility Checker

## Purpose
Discover public grants and subsidies across countries, but never assume worldwide eligibility. Unlike ordinary freelance and bounty discovery, grants are jurisdiction-dependent.

## Required eligibility context
Before determining eligibility, establish the applicant type and the jurisdiction facts relevant to the call: country/region, residence or citizenship where required, legal-entity registration and location, project location, sector, organization size, and other criteria expressly stated by the official call. Ask only for facts necessary for that specific call. If missing, report eligibility as UNVERIFIED.

## Verification workflow
1. Discover calls globally from official government, public agency, university, and recognized funding-body sources.
2. Capture official call URL, issuing body, publication and closing dates, funding amount/currency, eligible costs, co-funding, and application route.
3. Extract each eligibility criterion from the official call documents.
4. Compare applicant facts criterion by criterion: PASS, FAIL, or UNKNOWN, with source evidence.
5. Identify exclusions, deadlines, required documents, matching funds, reporting duties, and any costs.
6. Treat directories and third-party summaries as discovery leads only; official call terms control.

## Output
Provide global discovery results and a transparent eligibility matrix. Never label a call eligible unless all mandatory criteria are evidenced. Mark missing facts UNKNOWN and explain what must be checked. Do not promise award success.

## Safety
Research and preparation only. Never create accounts, submit applications, sign declarations, contact agencies, spend money, or upload personal documents. Do not invent applicant credentials or alter facts to fit a call. Flag paid intermediaries and application fees; do not use them under the free-only rule. External submissions require separate explicit user approval and app-specific permissions.

## Provenance
CEOAI-specific jurisdiction-aware workflow. No external runtime dependency is included.
