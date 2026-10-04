import {
  decideOidcAccess,
  deriveOidcUsername,
  extractGroups,
  MAX_GROUPS_PER_TOKEN,
  readClaimPath,
  sanitizeObservedGroups,
} from './oidc-claims.js';

const rules = {
  allowUnmatchedViewer: false,
  managerGroups: ['ezrepo-managers'],
  systemAdministratorGroups: ['ezrepo-admins'],
  viewerGroups: ['ezrepo-viewers'],
};

describe('OIDC claim handling', () => {
  it('prefers an exact claim name before traversing a safe dot path', () => {
    const claims = {
      'realm.groups': ['exact'],
      realm: { groups: ['nested'] },
    };

    expect(readClaimPath(claims, 'realm.groups')).toEqual({ found: true, value: ['exact'] });
    expect(readClaimPath({ realm: claims.realm }, 'realm.groups')).toEqual({ found: true, value: ['nested'] });
    expect(readClaimPath(claims, '__proto__.groups')).toEqual({ found: false, unsafe: true });
  });

  it('rejects malformed, overage, and oversized group claims', () => {
    expect(extractGroups({ groups: 'admin' }, 'groups')).toMatchObject({ status: 'malformed' });
    expect(extractGroups({ hasgroups: true }, 'groups')).toEqual({ status: 'overage' });
    expect(
      extractGroups({ groups: Array.from({ length: MAX_GROUPS_PER_TOKEN + 1 }, () => 'group') }, 'groups'),
    ).toMatchObject({ status: 'malformed' });
    expect(extractGroups({ groups: ['x'.repeat(513)] }, 'groups')).toMatchObject({ status: 'malformed' });
  });

  it('applies exact group mappings in descending role priority', () => {
    expect(
      decideOidcAccess({ groups: ['ezrepo-viewers', 'ezrepo-admins', 'EZREPO-ADMINS'], status: 'ok' }, rules),
    ).toMatchObject({ ok: true, role: 'SYSTEM_ADMIN' });
    expect(decideOidcAccess({ groups: ['ezrepo-managers'], status: 'ok' }, rules)).toMatchObject({
      ok: true,
      role: 'MANAGER',
    });
    expect(decideOidcAccess({ groups: ['unmapped'], status: 'ok' }, rules)).toEqual({
      ok: false,
      reason: 'no_matching_group',
    });
    expect(decideOidcAccess({ status: 'missing' }, { ...rules, allowUnmatchedViewer: true })).toMatchObject({
      ok: true,
      role: 'VIEWER',
    });
  });

  it('derives stable, non-claim usernames and bounds observed group suggestions', () => {
    expect(deriveOidcUsername('https://issuer.example', 'subject')).toMatch(/^oidc_[a-f0-9]{24}$/);
    expect(deriveOidcUsername('https://issuer.example', 'subject')).toBe(
      deriveOidcUsername('https://issuer.example', 'subject'),
    );
    expect(deriveOidcUsername('https://issuer.example', 'other')).not.toBe(
      deriveOidcUsername('https://issuer.example', 'subject'),
    );
    expect(sanitizeObservedGroups([' valid ', '', 'valid', 'x'.repeat(129)])).toEqual(['valid']);
  });
});
