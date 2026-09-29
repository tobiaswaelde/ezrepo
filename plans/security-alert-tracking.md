# Track security alerts across repositories

## Summary

Add a read-only **Alerts** section with separate Dependency, Code Scanning, and Secret Scanning views. GitHub supplies
all three alert types through its security APIs. GitLab vulnerabilities are normalized from the matching Dependency
Scanning, SAST, and Secret Detection report types. Forgejo and Gitea remain explicitly unsupported until they expose
equivalent read APIs.

Only system administrators and managers with a `MANAGER` membership for the repository may read security alerts.
Secret values, token fragments, provider credentials, and raw provider responses must never be stored, logged, or
returned.

## Data and provider integration

- Add one normalized `SecurityAlert` model with:
  - kind: `DEPENDENCY`, `CODE`, or `SECRET`;
  - state: `OPEN`, `RESOLVED`, or `DISMISSED`;
  - severity: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`, or `UNKNOWN`;
  - provider ID, title, safe description, identifiers, scanner, timestamps, resolution, and provider URL;
  - optional package, ecosystem, manifest, vulnerable range, fixed version, code rule, tool, secret type, and secret
    provider metadata;
  - typed safe-location JSON that excludes secret values and unfiltered provider payloads; and
  - a unique repository, kind, and provider-ID constraint plus indexes for list filters.
- Add a per-repository, per-kind synchronization state: `AVAILABLE`, `UNAVAILABLE`, or `UNSUPPORTED`, including the
  last successful sync and a sanitized reason when data cannot be read.
- Extend the provider adapter contract with an optional read-only alert listing that returns normalized alerts and
  availability by kind:
  - GitHub reads Dependabot, code-scanning, and secret-scanning alerts.
  - GitLab reads GraphQL vulnerabilities and maps only `DEPENDENCY_SCANNING`, `SAST`, and `SECRET_DETECTION`.
  - Forgejo and Gitea return `UNSUPPORTED` without making an alert request.
- Treat non-rate-limited permission, feature, and license failures as `UNAVAILABLE`. Preserve the existing retry
  behavior for rate limits, server failures, and network failures.
- Update GitHub OAuth to request `repo security_events`. Document reauthorization for existing OAuth accounts and
  the three read permissions required by fine-grained personal access tokens. Keep GitLab's existing
  `read_api read_user` scopes and document its license and role requirements.

## Synchronization and notifications

- Add the repository sync scope `ALERTS`, progress phase `SYNCING_ALERTS`, queue persistence, webhook coalescing, and
  per-kind durable cursors.
- Fetch and upsert alerts idempotently. The first successful sync for each kind establishes a silent baseline; later
  discoveries and state transitions may emit notifications.
- Map GitHub `open` and GitLab `DETECTED` or `CONFIRMED` to `OPEN`; map fixed or resolved states to `RESOLVED`; map
  dismissed and auto-dismissed states to `DISMISSED` while preserving the sanitized provider state and resolution.
- Add six notification events: `DEPENDENCY_ALERT_OPENED`, `DEPENDENCY_ALERT_RESOLVED`, `CODE_ALERT_OPENED`,
  `CODE_ALERT_RESOLVED`, `SECRET_ALERT_OPENED`, and `SECRET_ALERT_RESOLVED`.
- Treat dismissed alerts as resolved for notifications and a later reopening as opened. Reuse the existing channel,
  repository-filter, delivery-deduplication, retry, and history infrastructure.
- Relate notification deliveries to their source alert and build payloads only from safe normalized fields.
- Complete other repository sync scopes when an alert kind is unavailable. Derive a persistent `WARNING` job status
  after completion and expose the affected kinds without converting the whole sync into a failure.

## API and authorization

- Add a `SecurityAlert` CASL subject and a Query Kit service that applies repository restrictions inside Prisma
  queries. Access requires `SYSTEM_ADMIN`, or both the global `MANAGER` role and a repository `MANAGER` membership.
- Add these authenticated endpoints under `/api/v1/security-alerts`:
  - `GET /security-alerts` for paginated, permission-scoped queries;
  - `GET /security-alerts/summary` for kind-specific counters and unavailable-repository counts;
  - `GET /security-alerts/filter-options` for visible repositories and type-specific filter values; and
  - `GET /security-alerts/:id` for a safe detail DTO.
- Support common search, kind, repository, provider, state, severity, and date filters. Add dependency ecosystem,
  package, and manifest filters; code scanner, rule, and path filters; and secret type and provider filters.
- Extend the dashboard summary with permission-scoped open alert counts grouped by kind and severity. Return no alert
  summary to callers without the security-alert role.
- Extend repository and job DTOs with alert availability, `ALERTS`, `SYNCING_ALERTS`, `WARNING`, and warning kinds.

## Web application

- Add an **Alerts** sidebar group with `/alerts/dependencies`, `/alerts/code`, and `/alerts/secrets`, visible only to
  managers and system administrators.
- Reuse one typed alert table and one detail component across the three routes. Include summary cards, relevant
  filters, unavailable-data warnings, safe metadata, and the provider link.
- Add a combined recent-alert section to repository details and preserve repository filters when opening a full alert
  list.
- Add an open-alert dashboard card grouped by kind and severity.
- Add alert subscriptions to the notification-channel editor and safe alert subjects to delivery history.
- Show the derived warning status and affected alert kinds in the jobs page and repository sync status.
- Add English and German copy and keep every shipped locale structurally complete relative to the English locale.

## Tests and verification

- Add fixture-based adapter tests for the three GitHub endpoints and GitLab GraphQL pagination, mapping, and partial
  availability.
- Test normalization, idempotent upserts, independent baselines and cursors, reopening, resolution, dismissal, and
  secret-data redaction.
- Test queue scope persistence, progress, webhook coalescing, warning derivation, transient retries, and successful
  processing of unaffected scopes.
- Add authorization integration tests proving viewers cannot read alerts, managers see only managed repositories, and
  system administrators see all repositories.
- Test Query Kit pagination and filters, summaries, dashboard aggregation, safe details, notification deduplication,
  delivery payloads, and history.
- Add frontend tests for navigation, tables, details, filters, empty/error/unavailable states, dashboard metrics,
  notification events, jobs, and locale parity.
- Verify manager and viewer behavior visually in a browser at desktop and narrow viewport sizes.
- Run Prisma validation and generation, focused tests, API and web linting, type checking, complete test suites,
  builds, documentation checks, and `git diff --check`.
- Add exactly one focused minor Changeset for `ezrepo` with the implementation.

## Assumptions and exclusions

- GitLab report types other than Dependency Scanning, SAST, and Secret Detection remain out of scope.
- Security alerts are retained without a new retention setting in this implementation.
- A notification channel may subscribe to any combination of the six alert events; separate transports per kind are
  not required.
- MCP tools, record-level global search, provider-side alert mutations, and Forgejo or Gitea alert emulation remain out
  of scope.
- Existing unrelated working-tree changes must remain untouched.
