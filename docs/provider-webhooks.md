---
title: Repository webhook setup
description: Configure signed read-only webhooks for GitHub, GitLab, Forgejo, and Gitea repositories.
---

# Repository webhook setup

ezRepo can receive signed webhooks to synchronize a tracked repository sooner than its normal polling interval. It
never creates, updates, deletes, or tests webhooks through provider APIs. An administrator configures every repository
webhook manually in GitHub, GitLab, Forgejo, or Gitea.

Open **Repositories**, select a tracked repository, and use its **Repository webhook** card. The card shows the
repository-specific callback URL, generates or accepts a signing secret, and reports the last accepted delivery. ezRepo
never sends that configuration to the provider.

Webhooks are an optimization, not the source of truth. The signed payload must identify the repository selected by the
callback URL. ezRepo then reads current data through the configured read-only provider adapter. Accepted deliveries
enqueue a durable repository synchronization; deliveries received within 15 seconds are combined. The default fallback
polling interval is 30 minutes.

## Configure a repository webhook

1. Add the repository to ezRepo and open its **Repository webhook** card.
2. Copy the callback URL.
3. Generate a unique, high-entropy signing secret or paste the exact signing token supplied by the provider. Never
   reuse an access token or another repository's secret.
4. Save the secret. ezRepo encrypts it with AES-256-GCM and never returns it through the API.
5. Configure the callback URL and secret in that repository's provider settings.
6. Keep TLS verification enabled and send a test delivery.

The stable callbacks use `/api/webhooks/<provider>/<repository-id>`. Versioned
`/api/v1/webhooks/<provider>/<repository-id>` callbacks are also available. Provider-account callback URLs from ezRepo
0.2.9 and earlier are no longer accepted. After upgrading, recreate every webhook with its repository callback and a
new repository secret.

Successful deliveries return HTTP `202` with `{ "accepted": true }`. Repeated provider delivery IDs return
`{ "accepted": true, "duplicate": true }` and do not enqueue another synchronization. Unknown or disabled
repositories, disabled provider accounts, missing secrets, invalid signatures, mismatched provider repository IDs, and
missing delivery IDs are rejected without exposing configuration details.

Queued synchronization survives API restarts. Multiple instances use database leases and do not synchronize the same
provider account concurrently. Rate-limit headers delay work for the affected account, while bounded retries handle
transient failures.

## GitHub Actions

1. Open the repository's **Settings → Webhooks** and choose **Add webhook**.
2. Use `https://ezrepo.example.com/api/webhooks/github/<repository-id>` as the payload URL.
3. Select `application/json`, paste the repository secret, and subscribe to **Workflow runs** (`workflow_run`).
4. Keep SSL verification enabled and save the webhook.

ezRepo verifies `X-Hub-Signature-256` over the raw body and uses `X-GitHub-Delivery` for idempotency. See GitHub's
[webhook event documentation](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

## GitLab pipelines

1. Open the project's **Settings → Webhooks** and select **Add new webhook**.
2. Use `https://ezrepo.example.com/api/webhooks/gitlab/<repository-id>` as the URL.
3. Generate a **Signing token** and save its complete value, including `whsec_`, in the ezRepo repository card.
4. Select **Pipeline events**, keep SSL verification enabled, save, and send a test delivery.

ezRepo verifies Standard Webhooks HMAC-SHA256 signatures and prefers `webhook-id` for idempotency. Legacy
`X-Gitlab-Token` and `X-Gitlab-Event-UUID` headers remain supported for older instances. See GitLab's
[webhook documentation](https://docs.gitlab.com/user/project/integrations/webhooks/).

## Forgejo Actions

1. Open the repository's **Settings → Webhooks** and add a native **Forgejo** JSON webhook.
2. Use `https://ezrepo.example.com/api/webhooks/forgejo/<repository-id>` as the target URL.
3. Paste the repository secret and select **Push events** plus any available Actions events.
4. Keep TLS verification enabled and save the webhook.

ezRepo verifies `X-Forgejo-Signature` and uses `X-Forgejo-Delivery` for idempotency. Gitea-compatible headers remain
accepted for Forgejo compatibility. See the Forgejo [webhook documentation](https://forgejo.org/docs/latest/user/repository/webhooks/).

## Gitea Actions

1. Open the repository's **Settings → Webhooks** and add a native **Gitea** JSON webhook.
2. Use `https://ezrepo.example.com/api/webhooks/gitea/<repository-id>` as the target URL.
3. Paste the repository secret and select **Push events** plus any available workflow events.
4. Keep TLS verification enabled and save the webhook.

ezRepo verifies `X-Gitea-Signature` over the raw body and uses `X-Gitea-Delivery` for idempotency. See the Gitea
[webhook documentation](https://docs.gitea.com/usage/repository/webhooks/).

## Troubleshooting

- `401` means ezRepo could not verify the repository, provider type, secret, signature, payload repository ID, or
  delivery ID. Confirm the callback's repository UUID and exact secret.
- `202` with `duplicate: true` is expected when a provider retries a delivery.
- A successful delivery only triggers read-only synchronization; it never modifies the provider workflow.
- Check `/api/health` for persisted provider synchronization status.
- Set `SCHEDULER_SYNC_INTERVAL_SECONDS=1800` for the 30-minute fallback.
- `SCHEDULER_ENABLED=false` retains queued requests but pauses fallback enqueueing and processing.
