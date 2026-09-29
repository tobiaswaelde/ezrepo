import { describe, expect, it } from 'vitest';

import { syncErrorKind } from './sync-error';

describe('sync error presentation', () => {
  it.each([
    ['Provider rate limit reached.', 'rateLimit'],
    ['Provider credentials were rejected.', 'invalidCredentials'],
    ['Provider request failed with status 401.', 'invalidCredentials'],
    ['Provider permissions are insufficient.', 'missingPermissions'],
    ['Provider request failed with status 403.', 'missingPermissions'],
    ['Provider network request failed.', 'network'],
    ['Repository synchronization failed.', 'unknown'],
  ] as const)('classifies %s', (message, expected) => {
    expect(syncErrorKind(message)).toBe(expected);
  });
});
