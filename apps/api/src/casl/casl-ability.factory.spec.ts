import { subject } from '@casl/ability';

import { CaslAbilityFactory } from './casl-ability.factory.js';
import { CaslAction } from './casl-action.js';
import { CaslSubject } from './casl-subject.js';

describe('CaslAbilityFactory', () => {
  const factory = new CaslAbilityFactory();
  const memberships = [
    { repositoryId: 'repository-a', role: 'VIEWER' as const },
    { repositoryId: 'repository-b', role: 'MANAGER' as const },
  ];

  it('gives system administrators unrestricted access', () => {
    const ability = factory.createForUser({ id: 'admin', role: 'SYSTEM_ADMIN', username: 'admin' }, []);

    expect(ability.can(CaslAction.Delete, CaslSubject.User)).toBe(true);
    expect(ability.can(CaslAction.Update, CaslSubject.ProviderAccount)).toBe(true);
  });

  it('limits viewers to reading repositories and runs they are assigned to', () => {
    const ability = factory.createForUser({ id: 'viewer', role: 'VIEWER', username: 'viewer' }, memberships);

    expect(ability.can(CaslAction.Read, subject(CaslSubject.Repository, { id: 'repository-a' }))).toBe(true);
    expect(ability.can(CaslAction.Read, subject(CaslSubject.WorkflowRun, { repositoryId: 'repository-b' }))).toBe(true);
    expect(ability.can(CaslAction.Read, CaslSubject.NotificationChannel)).toBe(true);
    expect(ability.can(CaslAction.Read, CaslSubject.NotificationDelivery)).toBe(false);
    expect(ability.can(CaslAction.Read, subject(CaslSubject.Repository, { id: 'repository-c' }))).toBe(false);
    expect(ability.can(CaslAction.Update, subject(CaslSubject.Repository, { id: 'repository-b' }))).toBe(false);
  });

  it('does not grant repository managers global notification administration', () => {
    const ability = factory.createForUser({ id: 'manager', role: 'MANAGER', username: 'manager' }, memberships);

    expect(ability.can(CaslAction.Update, subject(CaslSubject.Repository, { id: 'repository-b' }))).toBe(true);
    expect(ability.can(CaslAction.Update, CaslSubject.NotificationChannel)).toBe(false);
    expect(ability.can(CaslAction.Read, CaslSubject.NotificationDelivery)).toBe(false);
    expect(ability.can(CaslAction.Update, subject(CaslSubject.Repository, { id: 'repository-a' }))).toBe(false);
    expect(ability.can(CaslAction.Update, subject(CaslSubject.Repository, { id: 'repository-c' }))).toBe(false);
  });
});
