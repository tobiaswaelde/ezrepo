---
title: Repository synchronization jobs
description: Monitor and manually start ezRepo repository synchronization jobs.
---

# Repository synchronization jobs

Open **Jobs** in the **Operations** section to inspect synchronization work for every enabled repository you can access.
The summary shows running, waiting, failed, and idle jobs. The table identifies the repository, provider, synchronized
domains, current phase, item progress, attempt, and most recent safe error message.

![Repository synchronization jobs](/screenshots/jobs.png)

Jobs remain visible while idle. A system administrator can start every currently idle or failed job with **Run all**, or
start a single repository from its table row. Jobs that are already pending or running are not queued again. Manual jobs
use the same durable, read-only provider synchronization queue as scheduled reconciliation and verified webhooks.

Successful jobs return to **Idle** and are not retained as execution history. Failed jobs remain visible until a later
webhook, reconciliation cycle, or manual retry queues them again.
