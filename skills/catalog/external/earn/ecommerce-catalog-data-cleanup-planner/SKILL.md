---
name: ecommerce-catalog-data-cleanup-planner
description: Scopes a product-catalog cleanup service covering data quality, taxonomy, duplicate detection, and safe import validation.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# E-commerce Catalog Data Cleanup Planner

## Purpose
Plan a paid catalog-cleanup deliverable that improves consistency without changing a live store.

## Workflow
1. Confirm client ownership or authorization for the supplied catalog export.
2. Inventory fields, formats, row counts, languages, currencies, and source-of-truth rules.
3. Define validation rules for identifiers, titles, descriptions, variants, prices, stock fields, categories, and image references.
4. Detect likely duplicates and conflicting records; preserve original identifiers and never merge uncertain matches automatically.
5. Identify missing values, inconsistent units, invalid URLs, malformed encodings, and taxonomy gaps.
6. Create a reversible correction proposal with sample rows and a change log.
7. Define import validation, backup, rollback, and client sign-off criteria.

## Output
Data-quality report, duplicate candidates, normalization rules, proposed corrections, sample validation, and safe import checklist.

## Safety and limits
- Use client-authorized exports and minimize personal data.
- Never change live prices, stock, orders, customer records, or store settings.
- Do not invent product attributes or overwrite source values without approval.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Data audit and correction proposal only.
