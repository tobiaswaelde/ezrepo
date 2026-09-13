---
title: Issues and pull requests
description: Browse read-only work items synchronized from tracked repositories.
---

# Issues and pull requests

ezRepo synchronizes issues and pull or merge requests only for enabled tracked repositories. Repository memberships
apply to lists, details, filter choices, and summary counts. Provider data remains read-only: use the external link to
comment, assign, label, close, approve, or merge at the provider.

## Issues

The **Issues** page combines visible repositories and shows open, recently updated, assigned, and stale counts. Search
by title or number, or filter by provider, repository, lifecycle, author, assignee, milestone, and labels. Selecting
multiple labels requires every selected label. Initial synchronization includes every open issue and closed issues
updated within the preceding 90 days.

## Pull requests and merge requests

The **Pull requests** page separates the provider lifecycle from the aggregate workflow status. GitLab links use the
provider term **Merge request**. **Workflow approval required** refers only to an approval-gated provider workflow; it
does not represent code-review approval, merge approval, or merge conflicts.

The aggregate workflow status uses the newest run for each linked workflow. Failed results take precedence over
running, pending, cancelled, successful, and unknown results. The provider URL remains the source of truth.

## Synchronization

Signed provider webhooks enqueue repository-specific issue, pull-request, or workflow synchronization after a
15-second coalescing window. A 30-minute reconciliation poll covers missed events. Synchronization uses paginated,
idempotent reads, provider rate-limit headers, and independent cursors with a small overlap to avoid timestamp gaps.

Descriptions are stored as provider Markdown and rendered with embedded HTML disabled and unsafe markup removed.
Comments, reviews, reactions, attachments, and code diffs are not synchronized.
