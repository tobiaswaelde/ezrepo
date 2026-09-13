import { Fields, buildFieldSchemaFromDto } from '@querry-kit/nest';
import type { ProviderAccount, Repository } from '../../../generated/prisma/client.js';
import { ProviderAccountDto, RepositoryDto, WorkflowRunDto, type WorkflowRunResourceModel } from './resource.dto.js';

describe('resource DTO mappings', () => {
  it('never serializes encrypted provider access tokens', () => {
    const dto = ProviderAccountDto.fromModel({
      id: 'account',
      providerType: 'GITHUB',
      displayName: 'GitHub',
      baseUrl: null,
      encryptedAccessToken: 'secret',
      enabled: true,
      lastSyncAt: null,
      lastSyncError: 'private detail',
      rateLimitResetAt: null,
      syncLeaseExpiresAt: null,
      syncLeaseToken: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ProviderAccount);

    expect(dto).toEqual({
      id: 'account',
      providerType: 'GITHUB',
      displayName: 'GitHub',
      baseUrl: null,
      enabled: true,
      lastSyncAt: null,
    });
    expect(dto).not.toHaveProperty('encryptedAccessToken');
  });

  it('allows Query Kit to project every provider-table field', () => {
    const schema = buildFieldSchemaFromDto(ProviderAccountDto);

    expect(schema).toEqual({
      baseUrl: true,
      displayName: true,
      enabled: true,
      id: true,
      lastSyncAt: true,
      providerType: true,
    });
    expect(Fields.parseAndValidate('id,displayName,providerType,baseUrl,enabled,lastSyncAt', schema)).toEqual(schema);
  });

  it('allows Query Kit to project every repository-table field', () => {
    const schema = buildFieldSchemaFromDto(RepositoryDto);

    expect(
      Fields.parseAndValidate(
        'id,name,owner,enabled,url,members,workflowRunCount,workflowRunRetentionDays,lastSyncAt',
        schema,
      ),
    ).toEqual({
      enabled: true,
      id: true,
      lastSyncAt: true,
      members: true,
      name: true,
      owner: true,
      url: true,
      workflowRunCount: true,
      workflowRunRetentionDays: true,
    });
  });

  it('maps the repository fields shown in the administration table', () => {
    const dto = RepositoryDto.fromModel({
      id: 'repository',
      providerRepositoryId: '42',
      owner: 'ezrepo',
      name: 'ezrepo',
      url: 'https://example.test/ezrepo',
      enabled: true,
      encryptedWebhookSecret: 'must-not-appear',
      lastSyncAt: null,
      retainedRunDurationMs: 0n,
      workflowRunRetentionDays: 30,
      memberships: [
        {
          userId: 'user-1',
          user: {
            avatar: { updatedAt: new Date('2026-09-12T10:00:00.000Z') },
            firstName: 'Vera',
            lastName: 'Viewer',
            username: 'viewer',
          },
        },
      ],
      providerAccountId: 'account',
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { workflowRuns: 12 },
    } as Repository);

    expect(dto).toEqual({
      id: 'repository',
      providerRepositoryId: '42',
      owner: 'ezrepo',
      name: 'ezrepo',
      url: 'https://example.test/ezrepo',
      enabled: true,
      lastSyncAt: null,
      members: [
        {
          avatarUpdatedAt: new Date('2026-09-12T10:00:00.000Z'),
          firstName: 'Vera',
          lastName: 'Viewer',
          userId: 'user-1',
          username: 'viewer',
        },
      ],
      workflowRunRetentionDays: 30,
      providerAccountId: 'account',
      workflowRunCount: 12,
    });
  });

  it('allows Query Kit to project every workflow-run table field', () => {
    const schema = buildFieldSchemaFromDto(WorkflowRunDto);

    expect(
      Fields.parseAndValidate(
        'id,url,workflowName,displayTitle,status,completedAt,durationMs,repositoryName,repositoryOwner,providerType',
        schema,
      ),
    ).toEqual({
      completedAt: true,
      durationMs: true,
      displayTitle: true,
      id: true,
      providerType: true,
      repositoryName: true,
      repositoryOwner: true,
      status: true,
      url: true,
      workflowName: true,
    });
  });

  it('excludes raw provider statuses from public workflow runs', () => {
    const dto = WorkflowRunDto.fromModel({
      id: 'run',
      providerRunId: '1',
      workflowName: 'Build',
      displayTitle: 'Build on main',
      url: 'https://example.test/run',
      providerCreatedAt: new Date(),
      startedAt: null,
      completedAt: null,
      durationMs: null,
      status: 'RUNNING',
      rawStatus: 'in_progress',
      repositoryId: 'repo',
      repository: {
        name: 'ezrepo',
        owner: 'twaelde',
        providerAccount: { providerType: 'GITHUB' },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as WorkflowRunResourceModel);

    expect(dto).not.toHaveProperty('rawStatus');
    expect(dto.status).toBe('RUNNING');
    expect(dto).toMatchObject({
      displayTitle: 'Build on main',
      providerType: 'GITHUB',
      repositoryName: 'ezrepo',
      repositoryOwner: 'twaelde',
    });
  });
});
