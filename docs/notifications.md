---
title: Notification management
description: Configure channels, rules, delivery history, and optional browser push for ezRepo workflow events.
---

# Notification management

The **Notifications** area contains three tabs:

- **Channels** configures Email, Gotify, ntfy, Discord, browser push, or a custom Apprise URL per repository.
- **Rules** selects which channels receive a completed `SUCCESS` or `FAILED` workflow run matching a workflow glob.
- **Delivery history** shows workflow and test deliveries, retry state, and safe channel/device attempt details.

Email, Gotify, ntfy, and Discord forms are translated into canonical
[Apprise service URLs](https://appriseit.com/services/) by the API. A separate Apprise server is not required;
ezRepo invokes its bundled Apprise CLI for these transports.

The complete destination configuration is encrypted with ezRepo's `TOKEN_ENCRYPTION_KEY` before it is stored. It
is write-only in the API and never returned to the web application, logs, delivery history, or error messages.
Editing a channel preserves its existing destination unless **Replace destination configuration** is selected.
Changing a channel type requires deleting and recreating the channel.

## Browser push

Browser push is a native ezRepo transport and does not use Apprise. Configure all three variables to enable it:

```dotenv
WEB_PUSH_VAPID_PUBLIC_KEY=...
WEB_PUSH_VAPID_PRIVATE_KEY=...
WEB_PUSH_VAPID_SUBJECT=mailto:admin@example.com
```

Generate the VAPID key pair with `npx web-push generate-vapid-keys`. The subject must be a `mailto:` or `https:`
URI. If the variables are omitted, browser push is shown as unavailable.

Each user explicitly enables push per browser with **Enable on this device**. Subscription endpoints and keys are
encrypted and deduplicated by a non-secret fingerprint. A browser-push channel belongs to its creator and sends to
all browsers that creator has enabled. Expired subscriptions reported with HTTP 404 or 410 are removed.

## Existing channels

Existing Apprise channels are assigned a stable type from their stored URL scheme. Unknown schemes remain available
as **Custom Apprise URL**. Existing encrypted URLs, repository ownership, rule links, and delivery records are not
rewritten or exposed.
