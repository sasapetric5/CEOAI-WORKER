---
name: freelance-payment-reconciliation
description: Reconciles user-supplied freelance invoices, payment confirmations, fees, and outstanding balances without accessing financial accounts or moving money.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Freelance Payment Reconciliation

## Purpose
Help a freelancer understand which issued invoices are paid, partially paid, overdue, disputed, or awaiting evidence using records the user explicitly supplies.

## Workflow
1. Accept only the minimum necessary invoice references, dates, currencies, amounts, payment status, and fee records.
2. Exclude passwords, full bank/card numbers, wallet seed phrases, private keys, authentication codes, and unnecessary personal data.
3. Match payment confirmations to invoice references by amount, currency, date, and transaction reference supplied by the user.
4. Classify each invoice as PAID, PARTIALLY PAID, UNPAID, OVERDUE, DISPUTED, or UNMATCHED; show the matching evidence and uncertainty.
5. Calculate outstanding balances and separately list platform/payment fees where known.
6. Flag currency mismatches, duplicate records, missing receipts, and unexplained deductions.
7. Prepare a reconciliation summary and a polite payment-query draft for human review.

## Output
Invoice ledger, matched-payment evidence, outstanding balance by currency, discrepancies, missing evidence, and optional draft query.

## Safety and limits
- Never connect to banks, payment processors, or wallets; never initiate payments, refunds, transfers, or chargebacks.
- Do not request or store credentials, card data, private keys, seed phrases, or authentication codes.
- Calculations are administrative assistance, not accounting, tax, or legal advice.
- No paid APIs. No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. User-provided records only.
