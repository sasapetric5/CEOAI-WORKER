---
name: analytics-event-taxonomy-planner
description: Designs a privacy-conscious analytics event taxonomy with clear names, properties, ownership, validation, and measurement definitions.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Analytics Event Taxonomy Planner

## Purpose
Help a freelancer deliver a maintainable analytics measurement plan before any tracking is implemented.

## Workflow
1. Capture business questions, user journeys, and decisions the analytics should support.
2. Define events using consistent verbs and nouns, with explicit trigger conditions.
3. Specify required and optional properties, types, allowed values, and ownership.
4. Exclude secrets, direct identifiers, sensitive attributes, and unnecessary free-text payloads.
5. Define consent and retention dependencies for client/legal review.
6. Map events to reports and metrics, including formulas and known limitations.
7. Create synthetic event examples and validation cases for duplicates, missing fields, invalid values, and version changes.

## Output
Event dictionary, property schema, journey map, metric definitions, privacy review questions, and QA test matrix.

## Safety and limits
- Do not install trackers, alter consent settings, or collect live user data.
- Do not provide legal compliance certification.
- Use synthetic examples only unless client-authorized and minimized.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Measurement design only.
