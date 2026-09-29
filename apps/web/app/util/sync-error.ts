export type SyncErrorKind = 'rateLimit' | 'invalidCredentials' | 'missingPermissions' | 'network' | 'unknown';

/** Classify credential-free synchronization messages for localized presentation. */
export function syncErrorKind(message: string): SyncErrorKind {
  if (message === 'Provider rate limit reached.') return 'rateLimit';
  if (message === 'Provider credentials were rejected.' || message === 'Provider request failed with status 401.')
    return 'invalidCredentials';
  if (message === 'Provider permissions are insufficient.' || message === 'Provider request failed with status 403.')
    return 'missingPermissions';
  if (message === 'Provider network request failed.') return 'network';
  return 'unknown';
}
