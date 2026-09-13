/** Persisted phase of a repository synchronization job. */
export type RepositorySyncProgressPhase =
  | 'LOADING_REPOSITORY'
  | 'SYNCING_ISSUES'
  | 'SYNCING_PULL_REQUESTS'
  | 'FETCHING_WORKFLOWS'
  | 'PROCESSING_WORKFLOWS'
  | 'REFRESHING_CHANGE_REQUESTS';

/** Progress update emitted while a repository synchronization is running. */
export interface RepositorySyncProgressUpdate {
  current: number | null;
  phase: RepositorySyncProgressPhase;
  total: number | null;
}

/** Callback used by synchronization services to persist observable job progress. */
export type RepositorySyncProgressReporter = (update: RepositorySyncProgressUpdate) => Promise<void>;
