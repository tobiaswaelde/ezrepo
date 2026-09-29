---
title: Provider OAuth setup
description: Register OAuth applications and configure read-only provider authentication for ezRepo.
---

# Provider OAuth setup

ezRepo connects provider accounts through OAuth or a personal access token (PAT). OAuth is available when at
least one provider OAuth client is configured. Without any configured OAuth clients, the provider-account screen
offers only PAT authentication. ezRepo uses either resulting credential only for its read-only provider APIs and
encrypts it before writing it to PostgreSQL.

## Register OAuth applications

Register one OAuth application for every provider instance that ezRepo should connect. Set the exact callback URL
from `OAUTH_CALLBACK_URL` in each application registration. For a local installation the default is
`http://localhost:3001/api/v1/provider-accounts/oauth/callback`.

Configure the client ID and client secret in the API environment, never in the web application or Git:

```dotenv
OAUTH_CALLBACK_URL=https://ezrepo.example.com/api/v1/provider-accounts/oauth/callback
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
GITLAB_OAUTH_BASE_URL=https://gitlab.example.com
GITLAB_OAUTH_CLIENT_ID=...
GITLAB_OAUTH_CLIENT_SECRET=...
FORGEJO_OAUTH_BASE_URL=https://forgejo.example.com
FORGEJO_OAUTH_CLIENT_ID=...
FORGEJO_OAUTH_CLIENT_SECRET=...
```

Configure only the providers that this installation needs. Client IDs and secrets must always be configured as pairs.
`GITLAB_OAUTH_BASE_URL` identifies the single GitLab instance for the installed OAuth application. Forgejo needs an
explicit base URL when its OAuth client is configured.

## Read scopes

Use these scopes when registering the application:

- GitHub: `repo security_events`. Existing OAuth accounts must be reauthorized before ezRepo can read security alerts.
- GitLab: `read_api read_user`.

Fine-grained GitHub personal access tokens need read access to Dependabot alerts, code scanning alerts, and secret
scanning alerts. GitLab security alert access additionally depends on the instance license and the token owner's
project role; unavailable alert types are shown without failing other repository synchronization scopes.

- Forgejo: `read:repository`.
- Gitea: configure a personal access token with read access in the Gitea provider-account form, including the
  instance base URL. ezRepo does not currently offer a shared Gitea OAuth client because every self-hosted
  instance needs its own application registration.

ezRepo's adapters expose only validation, discovery, workflow synchronization, and webhook verification. They do
not create, update, dispatch, rerun, cancel, or delete provider resources. OAuth client secrets stay in the API
environment, and provider tokens are never returned by the ezRepo API.
