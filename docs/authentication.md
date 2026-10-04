---
title: Authentication
description: Configure local authentication, optional OpenID Connect sign-in, and account recovery.
---

# Authentication

## First-run setup

After deploying a new installation, open its public URL. ezRepo redirects every request to `/auth/setup` until the
first account exists. Enter an optional first and last name, a unique username, and a password with at least 12
characters. The account is created as the system administrator and signed in immediately.

Setup can succeed only once. After the first user exists, `/auth/setup` redirects to `/auth/signin`. Existing
installations keep their current users during upgrades and do not show setup again.

## OpenID Connect single sign-on

ezRepo supports one optional OpenID Connect provider in addition to local sign-in. A system administrator configures
it under **Settings → Authentication**. This login is separate from GitHub, GitLab, Forgejo, and Gitea provider OAuth:
OIDC identifies an ezRepo user, while provider OAuth only grants read access to provider resources.

Set the exact externally reachable API callback URL before configuring the provider:

```dotenv
PUBLIC_URL=https://ezrepo.example.com
OIDC_CALLBACK_URL=https://ezrepo.example.com/api/v1/auth/oidc/callback
```

Register the value of `OIDC_CALLBACK_URL` as an allowed redirect URI at the identity provider. Configure its issuer,
client ID, optional client secret, scopes, and group claim in ezRepo. The client secret is write-only in the API and
is encrypted at rest with `TOKEN_ENCRYPTION_KEY`. Use **Check connection** before enabling sign-in.

HTTPS is required for the issuer and its endpoints. **Allow HTTP issuer** is only intended for isolated lab networks;
it must never be enabled for an Internet-reachable deployment. Local password sign-in remains available as a recovery
path even when OIDC is enabled.

### Groups, roles, and identities

The group claim can be one exact claim name or a dot-separated path such as `realm_access.groups`. Configure exact,
case-sensitive group values for the three ezRepo roles. If several groups match, ezRepo applies
`SYSTEM_ADMIN`, then `MANAGER`, then `VIEWER`. Unmatched, malformed, missing, or excessively large group claims are
denied unless **Allow unmatched users as viewer** is explicitly enabled.

An OIDC account is linked only by the verified issuer and subject pair. ezRepo never links an OIDC login to a local
account by email address or username. First and last names are synchronized from verified claims at each successful
login; login name, profile names, and password cannot be changed locally. Repository memberships remain managed in
ezRepo and are never derived from identity-provider groups.

Security-relevant configuration or role changes invalidate existing OIDC bearer tokens. Changing only the provider's
display name does not. Disabling or removing an identity-provider group prevents the affected account from obtaining
a new session and invalidates its previous sessions after the next denied login.

### Provider examples

For Authentik, create an OAuth2/OpenID Provider with authorization-code flow, the exact callback URL above, and the
`openid`, `profile`, and `email` scopes. Add a scope mapping that returns the chosen group claim as an array of group
names, attach the provider to an application, then copy the application's issuer, client ID, and client secret into
ezRepo.

For another standards-compliant provider, enable Authorization Code Flow, require S256 PKCE, register the exact
callback URL, and include a stable `sub` plus the configured group claim in the ID token or UserInfo response. ezRepo
accepts only asymmetric ID-token signatures and rejects unsigned and HMAC-signed tokens.

### OIDC API contract

| Method       | Path                         | Access               | Purpose                                                                      |
| ------------ | ---------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `GET`        | `/api/v1/auth/oidc/status`   | Public               | Returns only effective availability and the optional provider name.          |
| `GET`        | `/api/v1/auth/oidc/start`    | Public               | Starts a browser-bound authorization-code and S256 PKCE transaction.         |
| `GET`        | `/api/v1/auth/oidc/callback` | Public               | Validates the provider response and redirects with a one-time fragment code. |
| `POST`       | `/api/v1/auth/oidc/exchange` | Public               | Consumes the fragment code once and returns the normal bearer `AuthResult`.  |
| `GET`, `PUT` | `/api/v1/auth/oidc/config`   | System administrator | Reads or updates secret-safe OIDC settings.                                  |
| `POST`       | `/api/v1/auth/oidc/check`    | System administrator | Checks the saved discovery configuration without changing it.                |

The callback never places a bearer JWT in a URL. Its opaque exchange code expires after 60 seconds and can be used
only once. Provider errors are reduced to stable error codes before they reach the browser or logs.

## Change your password

While signed in, open **Settings → General → Change password**. Enter the current password, the new password, and its
confirmation. ezRepo keeps the current browser signed in with a replacement access token and invalidates tokens held
by every other signed-in session.

## Reset a forgotten password

ezRepo deliberately has no email-based password reset. A deployment administrator can reset a local account from the
directory containing `compose.yml`. Read the replacement password without echoing it or storing it in shell history,
then send it to the API container over standard input:

```bash
read -rsp 'New ezRepo password: ' EZREPO_NEW_PASSWORD
printf '\n'
printf '%s\n' "$EZREPO_NEW_PASSWORD" \
  | docker compose exec -T api node dist/scripts/reset-password.js USERNAME
unset EZREPO_NEW_PASSWORD
```

Replace `USERNAME` with the exact login username. The command requires a password between 12 and 256 characters,
updates only that local account, and invalidates all of its existing access tokens. Sign in again with the new
password afterward. The command rejects OIDC-managed accounts because they have no local password.
