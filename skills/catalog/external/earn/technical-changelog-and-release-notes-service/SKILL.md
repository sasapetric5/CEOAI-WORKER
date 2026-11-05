---
name: technical-changelog-and-release-notes-service
description: Transforms verified commits, issue references, and change records into clear release notes.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Technical Changelog and Release Notes Service

## Purpose
Transforms verified commits, issue references, and change records into clear release notes.

## Workflow
1. Use only supplied or authorized repository metadata.
2. Group changes into features, fixes, security, compatibility, and known issues.
3. Verify each claim against a commit, merged change, or approved issue.
4. Explain user impact and migration actions in plain language.
5. Flag missing version or compatibility information instead of guessing.
6. Produce audience-specific technical and user-facing drafts.

## Output
Evidence-linked changelog, user-facing release notes, upgrade notes, and unresolved-claim list.

## Safety and limits
- Do not publish, tag releases, or claim unverified fixes. Avoid exposing vulnerability details before the client's disclosure approval. No runtime activation or tool grants.
- Research, drafting, and planning only; execution requires a separate future approval and reviewed integration.

## Provenance
CEOAI-authored workflow. Intake candidate only.
