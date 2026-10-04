import { createCaslAccessibleWhere } from '@querry-kit/nest';

import { CaslAbilityFactory } from './casl-ability.factory.js';
import { CaslAction } from './casl-action.js';
import { CaslSubject } from './casl-subject.js';
import type { AppAbility } from './types.js';

describe('CASL Prisma integration', () => {
  it('converts a repository ability into a database where restriction', () => {
    const ability = new CaslAbilityFactory().createForUser(
      { authProvider: 'LOCAL' as const, id: 'viewer', role: 'VIEWER', username: 'viewer' },
      [{ repositoryId: 'repository-a', role: 'VIEWER' }],
    );
    const accessibleWhere = createCaslAccessibleWhere<AppAbility, CaslSubject.Repository, CaslAction>({
      action: CaslAction.Read,
    });

    expect(accessibleWhere(ability, CaslSubject.Repository)).toEqual({
      OR: [{ id: { in: ['repository-a'] } }],
    });
  });
});
