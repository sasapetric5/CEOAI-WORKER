---
name: freelance-ai-dataset-quality-audit-planner
description: Plans a paid, evidence-based audit of AI training or evaluation datasets for label quality, coverage, leakage, and documentation.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Freelance AI Dataset Quality Audit Planner

## Purpose
Scopes a client-facing quality audit for supplied AI training, fine-tuning, or evaluation datasets. This is distinct from general spreadsheet cleanup: it focuses on annotation validity, class balance, sampling, leakage, and dataset documentation.

## Workflow
1. Confirm the dataset owner, permitted purpose, data rights, sensitivity, and approved handling method before reviewing any data.
2. Inventory schema, task definition, label taxonomy, dataset splits, provenance, and known collection constraints.
3. Design a representative, privacy-minimized sample and label-review rubric; do not ingest sensitive records without explicit authorization and safeguards.
4. Assess label consistency, ambiguous classes, missingness, duplicates, class imbalance, split leakage, and potential contamination.
5. Separate measured findings from hypotheses; quantify sample sizes and confidence limitations.
6. Prioritize corrective actions and define repeatable acceptance checks.

## Output
Audit scope, sampling plan, annotation rubric, quality findings, risk register, remediation backlog, and retest criteria.

## Safety and limits
- Never train models, upload client data to external services, infer sensitive attributes, or retain dataset rows.
- No runtime activation or tool grants. Research, planning, and report drafting only; client data access requires separate authorization and approved handling controls.
- Do not claim statistical certainty beyond the reviewed sample or promise model performance improvements.

## Provenance
CEOAI-authored workflow. Intake candidate only.
