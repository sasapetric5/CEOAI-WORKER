---
name: freelance-project-profitability-checker
description: Calculates estimated net project value and effective hourly return from user-provided fees, effort, platform charges, expenses, and risk assumptions.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Freelance Project Profitability Checker

## Purpose
Help a freelancer compare project options using transparent arithmetic and explicit uncertainty. It does not provide tax advice or predict guaranteed income.

## Workflow
1. Collect proposed fee, currency, estimated delivery hours, expected revisions, communication/admin time, platform fees, payment charges, and direct project expenses.
2. Separate known values, user estimates, and unknown costs.
3. Calculate gross amount, known deductions, estimated net before tax, total estimated hours, and effective hourly return.
4. Model best/base/worst cases for effort and costs when uncertainty is material.
5. Include unpaid discovery, onboarding, revisions, support, and handoff time if the user expects to perform them.
6. Compare alternatives on the same currency and assumptions; do not silently mix exchange rates or tax treatment.
7. Flag missing legal/tax obligations for local professional verification; do not estimate taxes without explicit reliable inputs.
8. State the minimum fee or scope adjustment implied by the user's chosen hourly floor, if provided.

## Output
Transparent calculation table, assumptions, sensitivity scenarios, unknown deductions, effective hourly range, and negotiation options (reduce scope, change billing model, or decline).

## Safety and limits
- Calculations are estimates, not accounting, tax, or legal advice.
- Never invent fees, exchange rates, taxes, hours, or likely earnings.
- Do not connect to bank accounts, wallets, payment processors, or submit invoices.
- No paid APIs or tools. No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Calculation and decision support only.
