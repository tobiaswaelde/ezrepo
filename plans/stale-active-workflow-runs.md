# Reconcile stale active workflow runs

## Summary

Update every locally active workflow run during the next repository synchronization instead of refreshing only the
newest run in each workflow context. This corrects stale queued or running states without deleting workflow history.

## Changes

- Refresh every stored `QUEUED` or `RUNNING` run while retaining the existing refresh of current failed and
  approval-gated runs.
- Reuse runs returned by the incremental provider listing instead of fetching them again individually.
- When an active run no longer exists at the provider, mark it as `UNKNOWN`, clear its approval state, and refresh any
  linked pull-request aggregate.
- Keep the API, DTOs, database schema, and UI unchanged. Cleanup occurs during the repository's next successful sync.
- Add one focused patch Changeset for `ezrepo` with the implementation.

## Tests

- Refresh multiple active runs that share a workflow and execution scope.
- Avoid an additional provider request for active runs already returned by the incremental listing.
- Mark missing active runs as `UNKNOWN`, clear approval state, and update linked pull requests.
- Preserve the existing refresh behavior for current failed runs.
- Run the focused API tests, affected type checking and linting, and `git diff --check`.

## Assumptions

- Provider data remains authoritative; ezRepo neither deletes runs nor infers a terminal state from age or duplicate
  names alone.
- A missing run keeps its existing `completedAt` value because the provider supplies no reliable completion time.
- Existing unrelated working-tree changes remain untouched.
