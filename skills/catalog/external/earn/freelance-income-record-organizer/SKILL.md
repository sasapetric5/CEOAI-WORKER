---
name: freelance-income-record-organizer
description: Organizes user-provided freelance income and expense records into a clear period summary with currencies and evidence gaps kept explicit.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Freelance Income Record Organizer

## Purpose
Create a simple, auditable overview of freelance income records and project expenses. It does not calculate tax liability or replace bookkeeping software.

## Workflow
1. Define the reporting period and currencies to include.
2. Collect only user-provided invoice, receipt, payout, and expense summaries; avoid unnecessary sensitive identifiers.
3. Normalize dates, descriptions, currencies, gross amounts, known fees, and net received amounts without silently converting currencies.
4. Link each entry to the evidence the user supplied and mark missing receipts or uncertain classifications.
5. Separate invoiced revenue, received payments, outstanding invoices, refunds, platform fees, and project expenses.
6. Produce totals per currency and a consolidated view only if the user supplies a verified exchange rate and date.
7. List records that may need professional accounting or tax classification.

## Output
Period summary, categorized ledger, totals by currency, reconciliation gaps, evidence checklist, and export-ready table.

## Safety and limits
- Do not infer or calculate taxes, statutory contributions, or legal obligations without verified jurisdiction-specific inputs and qualified guidance.
- Never access bank accounts, payment apps, wallets, or private financial records directly.
- Do not request credentials, card numbers, private keys, seed phrases, or authentication codes.
- No financial transactions, invoice issuance, or tax filing.
- No paid APIs. No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Organization and arithmetic only.
