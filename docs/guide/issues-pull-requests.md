---
title: Issues and pull requests
description: Browse read-only work items synchronized from tracked repositories.
---

# Issues and pull requests

ezRepo synchronizes issues and pull or merge requests only for enabled tracked repositories. Repository memberships
apply to lists, details, filter choices, and summary counts. Provider data remains read-only: use the external link to
comment, assign, label, close, approve, or merge at the provider.

## Issues

The **Issues** page combines visible repositories and summarizes open, recently updated, assigned, and stale issues.
Search by title or number, or filter by provider, repository, lifecycle, author, assignee, milestone, and labels.
Selecting multiple labels requires every selected label to be present.

Select a row to open the ezRepo detail view. It shows synchronized provider metadata and sanitized Markdown while
keeping the provider link available for any change. Return to the list without losing the distinction between the
current filters and provider-owned state. Initial synchronization includes every open issue and closed issues updated
within the preceding 90 days.

If an expected issue is absent, confirm that its repository is enabled and assigned to you, clear filters, and review
the repository's job. Comments, reactions, attachments, and code diffs are intentionally not synchronized.

## Pull requests and merge requests

The **Pull requests** page summarizes open changes, drafts, failed workflows, and workflow approvals. It offers the same
repository, provider, lifecycle, people, milestone, label, and updated-time filters as the issue list. GitLab labels and
links use the provider term **Merge request**.

Open a row to inspect its source and target branches, draft state, labels, assignees, sanitized description, provider
lifecycle, and aggregate workflow status. **Workflow approval required** refers only to an approval-gated provider
workflow; it does not represent code-review approval, merge approval, or merge conflicts.

The aggregate workflow status uses the newest run for each linked workflow. Failed results take precedence over
running, pending, cancelled, successful, and unknown results. The provider URL remains the source of truth.

## Synchronization

Signed provider webhooks enqueue repository-specific issue, pull-request, or workflow synchronization after a
15-second coalescing window. A 30-minute reconciliation poll covers missed events. Synchronization uses paginated,
idempotent reads, provider rate-limit headers, and independent cursors with a small overlap to avoid timestamp gaps.

Descriptions are stored as provider Markdown and rendered with embedded HTML disabled and unsafe markup removed.
Provider events may take at least the coalescing window to appear. A system administrator can monitor or retry the
read-only operation from [Repository synchronization jobs](./jobs); refreshing the browser does not start a provider
write or bypass the synchronization queue.
