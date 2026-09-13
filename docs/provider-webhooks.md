---
title: Manual provider webhook setup
description: Configure signed read-only webhooks for GitHub, GitLab, Forgejo, and Gitea providers.
---

# Manual provider webhook setup

ezRepo can receive signed webhooks to synchronize a tracked repository sooner
than its normal polling interval. It never creates, updates, deletes, or tests
webhooks through GitHub, GitLab, Forgejo, or Gitea APIs. An administrator configures
each provider webhook manually in the provider UI.

System administrators can open **Administration → Provider accounts** in ezRepo
and choose **Configure webhook** for an account. The dialog shows the callback
URL, generates or accepts a signing secret, and reports the last accepted
delivery. ezRepo never sends that configuration to the provider.

Webhooks are an optimization, not the source of truth. ezRepo uses the
verified payload only to select a tracked repository, then reads workflow runs
through the configured read-only provider adapter. Accepted deliveries enqueue
a durable repository synchronization. Deliveries received within 15 seconds
are combined, and the default fallback polling interval is 30 minutes.

## Before creating a provider webhook

1. Create a ezRepo provider account and open its **Configure webhook** dialog.
2. Copy the generated callback URL.
3. Generate a unique, high-entropy signing secret in the dialog or paste the
   exact signing token supplied by the provider. Do not reuse an access token
   or a secret from another account.
4. Save the secret. ezRepo encrypts it with AES-256-GCM and never returns it
   through the API after the dialog is closed.
5. Expose ezRepo through a public HTTPS URL. The URL must reach the API,
   including its `/api` prefix, without a proxy rewriting the request body.

The provider-account management UI and API encrypt webhook secrets on the
ezRepo server. Do not use direct SQL with a plaintext secret.

Each accepted delivery returns HTTP `202` with `{ "accepted": true }`.
Repeated provider delivery IDs return `{ "accepted": true, "duplicate": true }`
and do not start another targeted synchronization. Invalid signatures,
unknown accounts, disabled accounts, missing secrets, or missing delivery IDs
are rejected without exposing account details.

Queued synchronization survives API restarts. Multiple API instances claim work
through expiring database leases and never synchronize the same provider account
in parallel. Provider rate-limit headers delay all queued work for that account;
bounded retries handle transient failures without tight retry loops.

The stable callback routes use `/api/webhooks/...`. Versioned
`/api/v1/webhooks/...` routes remain available for compatibility.

## GitHub Actions

1. Open the repository or organization **Settings → Webhooks** in GitHub and
   choose **Add webhook**.
2. Set the payload URL to:

   ```text
   https://ezrepo.example.com/api/webhooks/github/<provider-account-id>
   ```

3. Select `application/json` as the content type.
4. Paste this account's ezRepo webhook secret into GitHub's **Secret** field.
5. Subscribe to the **Workflow runs** event. GitHub calls this `workflow_run`;
   its completed activity is the most useful update for status tracking.
6. Keep SSL verification enabled and save the webhook.

ezRepo verifies the raw request body with GitHub's
`X-Hub-Signature-256` HMAC-SHA256 header and records `X-GitHub-Delivery` for
idempotency. See GitHub's [webhook event documentation](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

## GitLab pipelines

1. Open the GitLab project or group **Settings → Webhooks** and select **Add
   new webhook**.
2. Set the URL to:

   ```text
   https://ezrepo.example.com/api/webhooks/gitlab/<provider-account-id>
   ```

3. Generate a **Signing token**, copy the complete value (including `whsec_`),
   and store that exact value as this ezRepo account's encrypted webhook
   secret. GitLab displays the signing token only once.
4. Select the **Pipeline events** trigger and keep SSL verification enabled.
5. Save the webhook and send a test delivery only after the ezRepo secret is
   configured.

ezRepo verifies GitLab's current Standard Webhooks HMAC-SHA256 signature over
the raw body and prefers `webhook-id` for idempotency. It also supports the
legacy `X-Gitlab-Token` and `X-Gitlab-Event-UUID` headers for older GitLab
instances, but new webhooks should use signing tokens. See GitLab's
[webhook configuration documentation](https://docs.gitlab.com/user/project/integrations/webhooks/)
and [pipeline event reference](https://docs.gitlab.com/user/project/integrations/webhook_events/).

## Forgejo Actions

1. In the relevant Forgejo repository or organization, open **Settings →
   Webhooks** and add a native **Forgejo** webhook with POST JSON payloads.
2. Set the target URL to:

   ```text
   https://ezrepo.example.com/api/webhooks/forgejo/<provider-account-id>
   ```

3. Set the webhook secret to this account's unique ezRepo webhook secret.
4. Select **Push events**, which Forgejo documents for native webhooks. If the
   installed Forgejo version exposes an Actions or workflow-run event, it can
   be selected in addition. Polling remains the source of truth for run
   completion status.
5. Keep TLS verification enabled and save the webhook.

ezRepo verifies the raw request body with Forgejo's
`X-Forgejo-Signature` HMAC-SHA256 header and records `X-Forgejo-Delivery` for
idempotency. Gitea-compatible headers are accepted only for compatibility. The
monitored instance must expose the read-only Actions run API; otherwise
ezRepo reports the adapter limitation during synchronization. See the Forgejo
[webhook documentation](https://forgejo.org/docs/latest/user/repository/webhooks/)
and [Actions guide](https://forgejo.org/docs/latest/user/actions/overview/).

## Gitea Actions

1. Add a Gitea provider account using a personal access token with read access and the exact instance base URL,
   such as `https://gitea.example.com`. ezRepo appends `/api/v1` itself; do not include it twice.
2. In the Gitea repository or organization, open **Settings → Webhooks** and add a native **Gitea** webhook with
   JSON POST payloads.
3. Set the target URL to:

   ```text
   https://ezrepo.example.com/api/webhooks/gitea/<provider-account-id>
   ```

4. Set the webhook secret to the unique ezRepo secret stored with this provider account.
5. Subscribe to **Push events** and any available workflow events. Polling remains the source of truth for the
   final Actions run status.
6. Keep TLS verification enabled and save the webhook.

ezRepo verifies Gitea's raw request body with the `X-Gitea-Signature` HMAC-SHA256 header and records
`X-Gitea-Delivery` for idempotency. It only calls Gitea's read-only repository and Actions run endpoints after a
verified delivery. See the [Gitea webhook documentation](https://docs.gitea.com/usage/repository/webhooks/) and
[Actions API](https://docs.gitea.com/api/next/operations/get-workflow-runs/).

## Troubleshooting

- `401` means ezRepo could not verify the account, secret, signature, or
  delivery ID. Confirm the provider endpoint, account UUID, and exact secret.
- `202` with `duplicate: true` is safe and expected when a provider retries a
  delivery.
- A successful delivery does not mean a provider workflow was modified:
  ezRepo only performs a read-only synchronization afterwards.
- Check `/api/health` for the last persisted provider synchronization status.
  The health endpoint does not contact providers or expose secrets.
- Existing installations retain their configured polling interval. Set
  `SCHEDULER_SYNC_INTERVAL_SECONDS=1800` to use the 30-minute fallback.
- `SCHEDULER_ENABLED=false` leaves accepted requests persisted but pauses both
  fallback enqueueing and queue processing until scheduling is enabled again.
