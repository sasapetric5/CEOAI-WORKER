---
name: ai-agent-knowledge-base-audit
description: Audits a client-provided AI knowledge-base export for coverage, duplication, freshness, traceability, and retrieval risks.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# AI Agent Knowledge Base Audit

## Purpose
Define a document-audit service that improves the quality and maintainability of an AI agent's reference library.

## Workflow
1. Confirm the client has rights to provide the documents and define permitted processing and retention.
2. Inventory document names, formats, dates, owners, and declared source systems without collecting credentials.
3. Check for duplicate files, conflicting versions, missing metadata, stale dates, broken references, and unsupported claims.
4. Map each important user question to the source documents that should support its answer.
5. Flag sensitive data, personal information, secrets, and access-control mismatches for client review; do not reproduce them in the report.
6. Prioritize fixes by user impact, source authority, freshness, and remediation effort.
7. Produce a traceable findings register and a retest checklist using only the approved sample.

## Output
Inventory, coverage map, duplicate/conflict list, freshness findings, sensitivity flags, remediation backlog, and retest plan.

## Safety and limits
- Process only client-authorized material and minimize retained content.
- Do not infer permission from possession of a file.
- Do not upload documents to third-party services or modify the live knowledge base.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Audit planning and report drafting only.
