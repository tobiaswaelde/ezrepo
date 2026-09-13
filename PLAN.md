# ezRepo Monorepo and Release Plan

## Summary

Build ezRepo as a pnpm/Nx monorepo with:

- `apps/api`: NestJS REST API with Prisma, PostgreSQL, CASL, and `@querry-kit/nest`.
- `apps/web`: Nuxt 4 single-page dashboard with Pinia, Nuxt UI, and `@querry-kit/nuxt`.
- A Docker Compose production stack containing API, web, and PostgreSQL.
- GitHub Actions for linting, testing, and Changesets-driven Docker releases.

Follow the structure and conventions of:

- Frontend: `/mnt/projects/gerima/gerima-monorepo/apps/machine-admin-web`
- API: `/mnt/projects/gerima/gerima-monorepo/apps/machine-admin-api`

Do not copy Machine Admin domain models or endpoints.

## Technical Baseline

- Use Node.js 24, pnpm via Corepack, and TypeScript pinned exactly to `6.0.3`.
- Load and validate API environment variables with `envalid`; use `dotenv` only to load local environment files before validation.
- Configure TypeScript 6 at the workspace root and verify it in CI with API and web typechecks. Re-evaluate
  TypeScript 7 when the lint and import-organization toolchain supports its compiler API.
- Use strict TypeScript settings unless a framework-generated configuration requires an explicit compatibility override.
- Use Prettier, ESLint, JSDoc/TSDoc, and explicit types for exported APIs.

## API Implementation

- Use a versioned REST API under `/api/v1`, Swagger/Scalar documentation under `/docs`, and a health endpoint under `/api/health`. The health response must later report the API/database state and the last known connection or sync status for configured GitHub, GitLab, and Forgejo accounts, without exposing credentials or triggering provider requests.
- Maintain an `apps/api/bruno` collection with documented environments and request examples for manual API verification. Keep credentials in Bruno secret variables, and update the collection as protected endpoints are added.
- Structure every feature as a Nest module with module, service, controller, DTOs/types, and tests.
- Split Prisma schemas by domain, following the Machine Admin API layout.
- Use `@querry-kit/nest` for:
  - `QueryService`-based resource services;
  - pagination, filtering, sorting, and field selection;
  - `ResourceQuery.query` and `ResourceQuery.findById`;
  - DTO mapping with the active CASL ability.
- Use JWT bearer authentication with local username/password accounts and an initial admin created from environment variables.
- Define CASL roles and capabilities:
  - `SYSTEM_ADMIN`: unrestricted ezRepo administration.
  - `VIEWER`: read-only access to explicitly assigned repositories.
  - `MANAGER`: viewer access plus configuration access for assigned repositories.
- Enforce repository permissions in database queries, not only in DTO serialization.

Implement these feature modules:

- `auth`, `users`, `provider-accounts`, `repositories`, `workflow-runs`, `dashboard`, `jobs`, `notifications`, `webhooks`,
  `sync`, `init`, and `health`.

Persist at least:

- provider account and encrypted read-only access token;
- optional self-hosted GitLab or Forgejo base URL;
- tracked repository and repository membership;
- workflow whitelist and blacklist glob patterns, with blacklist precedence;
- provider run ID, repository, workflow name, URL, start time, completion time, duration, and normalized status;
- global retention policy and optional repository override;
- notification channels, rules, delivery attempts, and delivery outcome.

Normalize provider statuses into:

`queued`, `running`, `success`, `failed`, `cancelled`, `skipped`, and `unknown`.

Provider integration must be read-only:

- Read repository and run data from GitHub Actions, GitLab pipelines, and Forgejo Actions.
- Never create, modify, start, stop, or rerun provider workflows.
- Poll tracked repositories on a configurable schedule.
- Accept manually configured, signature-validated provider webhooks to trigger targeted syncs.
- Do not create or modify provider webhooks through ezRepo credentials.

Encrypt provider tokens and Gotify/ntfy credentials at rest. Never return secrets from API responses.

## Frontend Implementation

- Build the web app as a Nuxt 4 SPA with `ssr: false`.
- Follow the Machine Admin Web layout:
  - `app/pages`, `app/layouts`, `app/middleware`, `app/store`;
  - `app/composables/api`, `app/types/api`;
  - shared `components/common` and domain-specific `components/modules`.
- Implement `useApi`, `useModuleApi`, and `useTable` following the Machine Admin patterns.
- Use `@querry-kit/nuxt` for typed API and table behavior.
- Use `@querry-kit/nuxt-ui` types for filtering and sorting contracts; retain local `CommonTable*` UI controls.
- Use Pinia for authentication and app state, Nuxt UI for components, default dark mode, and English/German translations.

Create these pages:

- Sign-in page.
- Dashboard with:
  - tracked workflows whose latest terminal run failed;
  - the ten latest visible workflow runs;
  - success/error trend graph with selectable time range.
- Provider account administration for system administrators.
- Repository selection, tracking, workflow filters, retention, and memberships.
- Permission-scoped repository synchronization jobs with administrator-only manual start actions and live progress.
- Notification channel, rule, and delivery-history management.
- User administration for system administrators.

All pages, navigation items, API calls, charts, and tables must respect repository-level permissions.

## Notifications

- Support repository-scoped channels:
  - email recipient addresses using a globally configured SMTP transport;
  - Gotify;
  - ntfy.
- Support rules with repository, workflow glob pattern, outcome (`failed` or `success`), and one or more channels.
- Create at most one delivery per notification rule and workflow run.
- Persist every delivery attempt.
- Retry failed deliveries with bounded exponential backoff.
- Show final delivery status and errors to authorized users.

## Docker and Releases

- Provide Dockerfiles for API and web.
- Provide Docker Compose for API, web, PostgreSQL, persistent database storage, and a migration step before API startup.
- Read runtime configuration and secrets from environment variables only.
- Expect TLS termination through an external reverse proxy.

Create these GitHub Actions workflows:

- `lint.yml`
  - Run on pull requests and pushes to `main`.
  - Use frozen pnpm installation.
  - Run API lint, web lint, API typecheck, and Nuxt typecheck.

- `test.yml`
  - Run on pull requests and pushes to `main`.
  - Start PostgreSQL as a service container.
  - Generate Prisma client and apply test migrations.
  - Run API Jest tests and web component/composable tests.

- `deploy.yml`
  - Run on pushes to `main` and by manual dispatch.
  - Use `changesets/action` to create or update a release pull request.
  - Release only after that Changesets release pull request is merged.
  - Use one private root package named `ezrepo`; each Changeset increments the single application version.
  - Create a GitHub release and version tag after the release pull request merge.
  - Build and publish both images to GHCR:
    - `ghcr.io/<owner>/ezrepo-api`
    - `ghcr.io/<owner>/ezrepo-web`
  - Publish the exact SemVer version and `latest` tags for both images.
  - Grant only `contents: write`, `pull-requests: write`, and `packages: write`.

Use one shared `EZREPO_VERSION` in Docker Compose so API and web always deploy from the same release.

## Validation

- Unit tests for provider normalization, glob filtering, retention resolution, encryption, notification deduplication, and retry behavior.
- Adapter tests using recorded GitHub, GitLab, and Forgejo responses and webhook payloads.
- API integration tests proving viewers and managers cannot access or mutate data outside their repository assignments.
- Frontend tests for login redirects, permission-gated navigation, empty/error dashboard states, and table filtering.
- CI must verify TypeScript 7, Prisma migrations, linting, tests, typechecks, and release Docker image builds.
