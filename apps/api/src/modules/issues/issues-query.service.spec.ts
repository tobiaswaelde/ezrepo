import type { PrismaService } from '../../prisma/prisma.service.js';
import { IssuesQueryService } from './issues-query.service.js';

describe('IssuesQueryService', () => {
  it('AND-combines normalized labels with title or number search', () => {
    const service = new IssuesQueryService({ issue: {} } as PrismaService, {} as never);
    expect(service.toQueryOptions({ labels: ['Bug', 'Priority: High'], search: '42' } as never)).toMatchObject({
      where: {
        AND: [
          {},
          { OR: [{ number: { contains: '42' } }, { title: { contains: '42', mode: 'insensitive' } }] },
          { labels: { some: { label: { normalizedName: 'bug' } } } },
          { labels: { some: { label: { normalizedName: 'priority: high' } } } },
        ],
      },
    });
  });
});
