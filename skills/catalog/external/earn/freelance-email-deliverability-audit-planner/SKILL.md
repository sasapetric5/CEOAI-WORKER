---
name: freelance-email-deliverability-audit-planner
description: Scopes a read-only email-domain deliverability audit using supplied DNS records and provider diagnostics.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Freelance Email Deliverability Audit Planner

## Purpose
Plans a paid technical audit of a client's sending-domain configuration and deliverability risks. The service reviews configuration evidence; it does not send campaigns or access mailboxes.

## Workflow
1. Confirm domain ownership or written authorization and define the domains and sending services in scope.
2. Review supplied DNS evidence for SPF, DKIM selector coverage, DMARC policy/alignment, and relevant DNS hygiene.
3. Map legitimate sending sources and identify risks from undocumented third-party senders or overly broad SPF records.
4. Review provider-supplied aggregate diagnostics, bounce categories, and complaint trends without collecting mailbox contents or recipient lists.
5. Prioritize configuration gaps and explain dependencies, propagation considerations, and safe verification steps.
6. Prepare a staged remediation plan with rollback and post-change validation criteria.

## Output
Domain inventory, evidence-based configuration findings, risk-ranked remediation plan, verification checklist, and explicit exclusions.

## Safety and limits
- Never send test or marketing email, access mailboxes, collect recipient lists, alter DNS, or recommend unsolicited outreach.
- No runtime activation or tool grants. Read-only planning and report drafting only; any change requires separate owner approval.
- Do not promise inbox placement or bypass provider anti-abuse controls.

## Provenance
CEOAI-authored workflow. Intake candidate only.
