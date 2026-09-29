---
title: Security alerts
description: Review read-only dependency, code scanning, and secret scanning alerts.
---

# Security alerts

Managers and system administrators can open **Alerts** to review normalized Dependency, Code Scanning, and Secret
Scanning findings for repositories they manage. Lists, counters, filters, details, repository activity, and dashboard
metrics use the same repository permissions. Viewers cannot access alert data.

ezRepo stores only allowlisted metadata such as severity, state, scanner, package, rule, safe file location, and the
provider URL. Secret values, raw provider responses, credentials, and token fragments are never retained. Use **Open
in provider** for remediation; ezRepo does not dismiss, resolve, or otherwise modify provider alerts.

GitHub supports all three alert kinds through its security APIs. GitLab maps Dependency Scanning, SAST, and Secret
Detection vulnerabilities into the same views. Forgejo and Gitea currently report these alert kinds as unsupported.
An unavailable kind produces a warning without failing workflow, issue, or pull-request synchronization.

The first successful synchronization for each repository and alert kind establishes a silent baseline. Later opened,
resolved, dismissed, and reopened transitions can trigger notification channels subscribed to the matching alert
event. Existing GitHub OAuth accounts must be reauthorized for the `security_events` scope; see [OAuth setup](../provider-oauth).
