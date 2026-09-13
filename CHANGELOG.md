# Changelog

## 0.2.5

### Patch Changes

- b082487: Add the ezRepo logo and favicon, and recognize Changesets release tags in the update check.

## 0.2.4

### Patch Changes

- 27e9cce: Show workflow names alongside run titles in workflow-run tables.
- 6841b37: Resolve GitHub pull-request workflow failures whose Action payload omits the associated pull request.

## 0.2.3

### Patch Changes

- f29c7f9: Queue an initial workflow synchronization for newly tracked repositories and add a manual workflow retrieval action.

## 0.2.2

### Patch Changes

- 67cd92f: Move API and web container health checks into their Docker images.

## 0.2.1

### Patch Changes

- a06a9b1: Fix the release deployment workflow so it can publish API and web images to GitHub Container Registry.

## 0.2.0

### Minor Changes

- 572d86c: Add a permission-aware command palette for navigation, resource search, and existing creation workflows.
- a963004: Add permission-aware workflow health metrics, repository health ranking, an accessible status distribution, and a
  more readable dashboard trend visualization.
- 36676e2: Add OAuth and personal-access-token provider account setup, improve the administration experience, and add browser-backed form validation.
- 81f01bd: Standardize authenticated pages on a shared full-page toolbar and breadcrumb layout, add dismissible introductory
  banners with per-user persistence, and let users restore hidden introductions from settings.
- e7b83bd: Move repository configuration into a deep-linkable dialog and add tooltips to table row actions.
- 1e361be: Search permission-aware provider accounts, repositories, workflow runs, and navigation from one responsive global search.
- b987d7a: Use one permission-aware navigation definition for workflow-run sidebar children and global search destinations.
- 77c6690: Add an authorized, server-paginated needs-attention workflow-run view and limit the matching dashboard preview to the
  15 newest failures.
- b987d7a: Promote repositories to permission-aware top-level navigation with assigned read-only views for non-administrators.
- bd68d4e: Promote repositories to canonical top-level routes while preserving redirects from legacy administration URLs.
- f7a0a58: Add a production Docker Compose stack with PostgreSQL, Prisma migrations, API and web readiness checks, and release smoke-test support.
- 41de66b: Add permission-aware read-only MCP access with user-managed bearer tokens and operational workflow tools.
- 142e936: Replace transport-specific notification channels with encrypted Apprise URLs.

### Patch Changes

- 5c9f126: Rename the visible application branding to ezRepo and point users to the renamed GitHub repository.
- c57496a: Retry failed notification deliveries with bounded exponential backoff and persisted attempt history.
- 4fd5744: Upgrade Changesets CLI and release action together with the v3 workflow inputs.
- bc0c144: Encrypt provider credentials through a dedicated AES-GCM service.
- beec73e: Add browser coverage for sign-in redirects, role-aware navigation, and dashboard states.
- 2ef790f: Add an authorized dashboard summary of workflows whose latest terminal run failed.
- d55047c: Add the workflow dashboard with latest runs, failures, and trend charts.
- 73fa065: Keep Dependabot major updates separate from grouped minor and patch updates.
- fde99ab: Refresh compatible workspace dependencies while preserving the supported TypeScript and Node.js versions.
- 4c2440d: Publish the project documentation as a validated VitePress site on GitHub Pages.
- b7e29d0: Add repository-scoped notification channel persistence and API configuration endpoints.
- 2f8fe30: Add recorded GitHub, GitLab, and Forgejo adapter and webhook fixtures to the API test suite.
- fc51c72: Add provider-backed repository discovery and a multi-stage repository administration dialog.
- bb5ff57: Add repository workflow configuration and a filterable workflow-runs history view.
- fd919aa: Show the all-time workflow runtime on the dashboard, including repository-scoped retention history.
- 3f0cc3a: Align workflow administration tables with the compact tenant layout and persistent right-pinned actions.
- 340c866: Update Querry Kit Nuxt UI and use its shared toolbar for administration tables and workflow runs.
- 982a60c: Add read-only GitHub Actions repository and workflow run adapter support.
- 65378d6: Add read-only Forgejo Actions adapter support with version capability errors.
- 5e78f7e: Align the web dashboard layout with the Machine Admin application.
- 3bae2c8: Refresh renamed repository metadata automatically during synchronization and manually from repository details.
- 8721285: Simplify workflow run tables, show workflow-run counts for repositories, support searchable multi-repository
  selection, show loading feedback for API-backed actions, and add a live global API status bar with provider
  synchronization progress.
  Add administrative global settings for workflow-run retention and a shared selectable 24-hour date/time format.
  Only show a failing workflow when its newest provider run in the same repository is still failed.
  Show approval-gated workflows in a highlighted dashboard card and a searchable detail page with read-only provider
  and pull-request links.
- 2976195: Debounce webhook synchronization through a durable queue, honor provider rate limits, and use a 30-minute fallback
  polling interval.
- 5142879: Track provider workflows separately from their runs and limit needs-attention failures to stable execution contexts.
- aa0c348: Replace usable environment-template secrets with intentionally invalid placeholders.
- fbaa20e: Add authorized success and error workflow-run trends for requested UTC time ranges.
- 519077f: Validate email, Gotify, and ntfy channel configuration and encrypt write-only notification credentials.
- 7e5368d: Add Node 24 production Dockerfiles for the API and web applications.
- 02ee3ed: Expose notification delivery history only to authorized repository managers and system administrators.
- f357232: Fix API development startup by providing authorization dependencies to the MCP token controller.
- 5142879: Generate release changelogs from pending Changesets.
- 4432f70: Resolve known vulnerabilities in transitive API and web dependencies.
- 08e7319: Add uploadable, cropped user avatars and repository member avatar groups.
- 8119ca9: Add scheduled incremental provider synchronization with bounded retries.
- 0743cf2: Add CodeQL security analysis for application source and GitHub Actions workflows.
- 3434800: Document all ezRepo API environment variables and their validation constraints.
- c92a3e7: Report database and persisted provider synchronization status from the health endpoint.
- 725a9f7: Make full workspace validation exclude the recursive root project and always run API tests in test mode.
- 0ddc7d8: Exclude superseded workflow runs from approval queues, active dashboard counts, and provider refreshes.
- bffe8ef: Add the web sign-in form and authenticated application layout.
- 4249a2b: Fix Forgejo Actions synchronization by mapping the native workflow-run response, preserving pull-request context and
  approval state, and bounding incremental pagination.
- bde0b96: Add read-only Gitea Actions synchronization, signed webhook handling, and self-hosted provider account setup.
- 39e655c: Enforce and verify repository membership restrictions for every dashboard aggregate.
- 0b5f5e2: Add a typed web API client with bearer authentication and browser timezone headers.
- 5391163: Redesign provider-account administration with Query Kit tables, verified credentials, optional base URLs, and aligned navigation controls.
- 7601f67: Ensure pull-request test workflows fetch Changesets' local main reference.
- dfa70d2: Add global and repository-specific workflow run retention cleanup.
- 59ecec0: Add read-only GitLab project and pipeline adapter support.
- 7ed78a7: Deliver pending notifications through SMTP email, Gotify, and ntfy channel adapters.
- 28beb6d: Group workspace dependency updates so Dependabot retains a consistent pnpm lockfile.
- a07af96: Verify current Forgejo webhook signatures and delivery IDs while retaining Gitea compatibility.
- c2366d8: Create idempotent notification delivery records for matching workflow runs.
- de1d8b3: Add notification channel, rule, and delivery history screens.
- e507643: Add an authorized dashboard endpoint for the ten newest workflow runs.
- c3cb555: Package the API Prisma client, migrations, and production dependencies in the Docker image.
- b6110a1: Add system administrator provider-account management endpoints.
- bdc6c61: Add provider account administration screens.
- b3a50c7: Add repository, provider, and duration filters to workflow-run tables.
- 5f6ffac: Add a route-aware Query Kit table adapter that preserves local column metadata.
- ff21f49: Evaluate matching enabled notification rules whenever a terminal workflow run is persisted.
- 64af0ae: Clear obsolete change-request workflow failures after closure or successful validation on the merge target.
- c1f7134: Restore Changesets action compatibility with the pinned v2 CLI.
- ff526f6: Add persisted web authentication state, current-user refresh, and global route guards.
- b37d9b2: Verify current GitLab HMAC webhook signing tokens and preserve their delivery IDs for idempotency.
- c58f0b0: Prevent repository-scoped data access without a membership and validate workflow-run authorization against PostgreSQL.
- d67d592: Add workflow-run query, dashboard, and retention indexes.
- 6bdfe81: Add system administrator repository tracking configuration endpoints.
- 39c7e0f: Add repository tracking administration screens.
- c233ea8: Resolve security vulnerabilities in transitive Vite, esbuild, and smol-toml dependencies.
- 4f9cab5: Harden remote avatar downloads and refresh compatible dependencies.
- 5d48bde: Add guided first-run administrator setup, password management, and secure local password recovery.
- 911920e: Accept verified GitHub, GitLab, and Forgejo webhooks for idempotent targeted workflow synchronization.
- 338a6e5: Expand the web interface with Spanish, French, Italian, Dutch, Polish, and Portuguese translations and persistent locale selection.
- d5c5278: Define the read-only provider adapter contract.
- 6c20836: Strengthen unit-test coverage for workflow status normalization, retention policies, and credential integrity.
- e07ce7f: Centralize provider workflow status normalization while retaining raw statuses.
- cd6187e: Include safe workflow, repository, and provider context in dashboard run DTOs.
- a1021b5: Add safe API DTOs and ability-aware resource mappings.
- e511268: Show dashboard workflow successes and errors as responsive stacked bars.
- e8ce290: Keep full-page toolbars fixed below the application header while the page content scrolls independently, and let the
  dashboard use the complete available panel width.
- 206e383: Add authorized paginated, searchable, filterable, and sortable workflow-run queries.
- 35c5017: Align repository and user administration with the full-page Query Kit table layout and server-side resource queries.
- dae3cf1: Configure reviewed Dependabot updates for workspace dependencies and GitHub Actions.
- 9aeeea1: Document production deployment, reverse-proxy TLS, upgrade, backup, restore, and rollback procedures.
- 1e74fa9: Split settings into focused tabs and let users manage their personal names and login username.
- 5cc8b26: Present dismissible introductions as compact toolbars on full-page table views.
- 4b08d43: Improve the web interface structure with modular dashboard and repository components and enforce readable Vue formatting.
- 17a4cae: Add typed web API resource contracts and Query Kit endpoint wrappers.
- 30ec96c: Document manual signed webhook setup for GitHub, GitLab, and Forgejo.
- e525e8c: Add repository-scoped workflow notification rules with outcome and channel selection.
- e8ce290: Update Querry Kit Nuxt UI to version 3.3.1.
- 5d86933: Add system administrator user management endpoints.
- 0bab987: Add system user administration screens.
- d5bf0b7: Align the awaiting-approval workflow view with the full-page workflow-run table layout.
- 2c1dc3f: Verify idempotent workflow-run persistence for repeated provider synchronization.
- 4b1c711: Localize web administration and notification screens in English and German.
- c578682: Add the Nuxt 4 dashboard application foundation with UI, state, i18n, and Query Kit dependencies.

All notable changes to ezRepo are documented in this file by Changesets.
