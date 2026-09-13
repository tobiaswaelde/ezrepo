---
title: Workflow queues
description: Filter workflow runs and distinguish failures from provider approval requirements.
---

# Workflow queues

![All workflow runs](/screenshots/workflow-runs.png)

## All runs

**All runs** provides the retained, permission-scoped workflow history. Search by workflow or repository, or filter by
repository, provider, normalized status, and duration. Table controls change sorting and visible columns without
changing provider data. Provider time, start, completion, and duration can be absent when the provider did not supply
that stage of the run.

Select the external action for a row to inspect logs or other provider-owned details. ezRepo normalizes provider states
to queued, running, success, failed, cancelled, skipped, or unknown, but the linked provider page remains the source of
truth. An empty result means no retained run matches the current filters; clear filters before treating it as missing
synchronization.

## Needs attention

**Needs attention** contains actionable workflow contexts whose newest completed run failed. A later successful run,
closing the related change, or successfully merging it removes the context automatically. Use this queue for failures
that are current rather than searching the complete historical table.

Open the provider link to diagnose or resolve a failure. ezRepo cannot rerun, cancel, dispatch, or edit a workflow. If
the queue cannot be loaded, retry it and check [Repository synchronization jobs](./jobs) for a failed repository read.

## Awaiting approval

**Awaiting approval** lists workflows paused at a provider approval gate. Search by workflow or repository, use **Open
pull request** for surrounding review context, or choose **Approve in provider** to open the provider-owned approval
screen. GitLab may label the related change as a merge request.

ezRepo deliberately does not expose an in-app approval action. The row remains visible until a webhook or reconciliation
sync observes the provider's updated state. An empty approval queue means no visible synchronized run currently requires
approval; it does not grant or imply approval authority at the provider.
