---
name: wordpress-site-maintenance-audit
description: Creates a safe WordPress maintenance audit covering versions, backups, plugins, themes, security posture, and update planning.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# WordPress Site Maintenance Audit

## Purpose
Define a maintenance audit a freelancer can deliver without making changes to a live website.

## Workflow
1. Confirm site ownership or written client authorization and define the audit boundary.
2. Collect a client-provided inventory of WordPress core, PHP, themes, plugins, and hosting constraints.
3. Review official release and security advisories for known end-of-life or vulnerable components.
4. Check backup coverage, restore evidence, update history, admin-role hygiene, and exposed maintenance risks.
5. Identify plugin overlap, abandoned dependencies, unsupported themes, and compatibility questions.
6. Prioritize recommendations by exploitability, exposure, business impact, and available mitigation.
7. Produce a staged maintenance plan with backup, staging validation, rollback, and client approval gates.

## Output
Component inventory, risk register, backup/restore checklist, update sequence, staging test plan, and maintenance estimate.

## Safety and limits
- Do not log in, scan aggressively, exploit, update, or modify the live site.
- Never request administrator passwords, database dumps, or secret keys.
- Verify security claims against official advisories and record dates.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Audit planning only.
