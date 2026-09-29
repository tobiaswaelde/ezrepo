# ezRepo TODO

Work through these items in order. Complete and verify one focused task before starting the next one.

## 1. Reconcile stale needs-attention workflow runs

Context: [Needs-attention run analysis](codex://threads/01a0e5c8-d160-7280-9d56-b9ed8e4e3716)

- [x] Extend the existing repository synchronization to reconcile workflow runs with their pull or merge request.
  - [x] Resolve the change request when a provider run does not contain a direct pull-request reference.
  - [x] Do not introduce a separate check-runs job unless the existing synchronization cannot cover the behavior.
- [x] Exclude a run from Needs Attention when its change request is closed or merged.
- [x] Exclude an older failure when a newer successful run exists for the same execution context.
- [x] Correct existing stale records through the next full synchronization or a one-time backfill.
- [x] Test newer running and successful runs, closed and merged requests, reused branches, and missing provider mappings.

## 2. Small UI and localization fixes

- [x] Audit every locale for missing or inconsistent messages, including `common.save`.
- [x] Remove the Repository Health and Needs Attention cards from the dashboard.
- [x] Replace the Notifications page tab bar with Notifications subitems in the sidebar.
- [x] Replace the prominent version-update notice with a green dot beside the sidebar version number.
- [x] Keep the Awaiting Approval and Needs Attention sidebar badges current without reloading the application.
  - [x] Display each badge only when its value is greater than zero.
  - [x] Refresh the counts after relevant synchronization and navigation events.

## 3. Persistent table state and filters

- [x] Persist each table's selected page size in local storage under its existing table persistence key.
- [x] Allow useful table-filter selections to be saved locally and restored per table.
- [x] Consider a global repository selector that filters the dashboard, workflow runs, issues, and pull requests.
  - [x] Keep this optional until the repository detail page and local table persistence have been completed.

## 4. Repository detail page

- [x] Replace the empty repository detail route with a permission-aware page that reuses existing detail components.
- [x] Show repository information, workflow runs, issues, and pull requests in focused sections.
- [x] Show the last successful synchronization, latest error, active job, and age of the displayed data.
- [x] Mark repository data as stale when it exceeds the configured polling interval.
- [x] Provide consistent links from repositories, runs, issues, and pull requests to the provider resource.
- [x] Cover loading, empty, partial-error, unauthorized, and never-synchronized states.

## 5. Issue and pull-request retention

- [x] Add global retention settings for closed issues and closed or merged pull requests.
- [x] Add optional repository-specific overrides following the existing workflow-run retention behavior.
- [x] Delete only expired terminal records and preserve related data required by retained workflow runs or notifications.
- [x] Enforce authorization, validate retention ranges, and never expose provider credentials.
- [x] Test global defaults, repository overrides, active work items, relationship handling, and idempotent cleanup.

## 6. Notification and provider feedback

- [x] Add a notification-rule preview against existing workflow runs without sending a notification.
- [x] Distinguish no results, never synchronized, insufficient permission, synchronization failure, and partial data.
- [x] Present rate limits, invalid credentials, missing provider permissions, and network failures as distinct errors.

## 7. UI and accessibility review

- [ ] Review the application with Playwright and record reproducible visual or interaction problems.
- [ ] Verify the sidebar, wide tables, dialogs, detail pages, and navigation at desktop and narrow viewport sizes.
- [ ] Verify keyboard navigation, dialog focus handling, accessible names for icon buttons, and color contrast.
- [ ] Add focused browser coverage for each corrected regression instead of broad snapshot coverage.

## 8. Reconcile stale active workflow runs

Plan: [Reconcile stale active workflow runs](plans/stale-active-workflow-runs.md)

- [ ] Refresh every stored queued or running workflow run during repository synchronization.
- [ ] Mark active runs missing from the provider as unknown without deleting their history.
- [ ] Avoid duplicate provider reads and refresh linked pull-request workflow aggregates.
- [ ] Add focused tests and a patch Changeset.

## 9. Dependency updates

- [ ] Update Node.js packages in separate, reviewable groups.
  - [ ] Update workspace tooling and linting packages.
  - [ ] Update Nuxt, Vue, Nuxt UI, and frontend packages.
  - [ ] Update NestJS, Prisma, and API packages.
- [ ] Keep TypeScript pinned exactly to `6.0.3` unless separately requested and compatibility-tested.
- [ ] Run focused tests first, then lint, type checking, tests, and builds after each dependency group.
- [ ] Verify browser, Docker image, migration, and production-startup behavior after relevant major updates.
