import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
  ApiResourceQuery,
  QueryTransformPipe,
  ResourceQuery,
} from '@querry-kit/nest';

import type { Prisma, SecurityAlertKind, SecurityAlertSeverity } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { SecurityAlertQueryDto } from './dto/security-alert-query.dto.js';
import {
  SecurityAlertDto,
  SecurityAlertFilterOptionsDto,
  type SecurityAlertResourceModel,
  SecurityAlertSummaryDto,
} from './dto/security-alert.dto.js';
import { SecurityAlertsQueryService } from './security-alerts-query.service.js';

const securityAlertInclude = {
  repository: { select: { name: true, owner: true, providerAccount: { select: { providerType: true } } } },
} satisfies Prisma.SecurityAlertInclude;

/** Provides permission-aware security-alert list, detail, summary, and filter data. */
@ApiTags('security-alerts')
@Authenticated()
@Controller('security-alerts')
export class SecurityAlertsController {
  /**
   * Initialize the security-alert API controller.
   *
   * @param prisma - Database client for summaries and filter metadata.
   * @param alerts - Permission-aware Query Kit service.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: SecurityAlertsQueryService,
  ) {}

  /**
   * Query visible normalized security alerts.
   *
   * @param request - Authenticated request.
   * @param query - Validated pagination, filtering, and sorting options.
   * @returns Permission-scoped alert page.
   */
  @Get()
  @ApiOperation({ summary: 'Query visible security alerts' })
  @ApiResourceQuery()
  @ApiPaginatedResponse({ description: 'Visible normalized security alerts.', model: SecurityAlertDto })
  @ApiErrorResponses({ badRequestDescription: 'Invalid security-alert query.' })
  async query(
    @Req() request: { user: AuthenticatedUser },
    @Query(new QueryTransformPipe()) query: SecurityAlertQueryDto,
  ) {
    const ability = await this.alerts.getReadAbility(request.user);
    return ResourceQuery.query({
      ability,
      include: securityAlertInclude,
      map: (alert: SecurityAlertResourceModel) => SecurityAlertDto.fromModel(alert, false, ability),
      query: this.alerts.toQueryOptions(query),
      schema: SecurityAlertDto,
      service: this.alerts,
    });
  }

  /**
   * Aggregate open alerts and unavailable repositories.
   *
   * @param request - Authenticated request.
   * @returns Permission-scoped alert summary.
   */
  @Get('summary')
  @ApiOkResponse({ type: SecurityAlertSummaryDto })
  async summary(@Req() request: { user: AuthenticatedUser }): Promise<SecurityAlertSummaryDto> {
    const ability = await this.alerts.getReadAbility(request.user);
    const visible = this.alerts.visibleWhere(ability);
    const kinds: SecurityAlertKind[] = ['DEPENDENCY', 'CODE', 'SECRET'];
    const severities: SecurityAlertSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN'];
    const repositoryIds = await this.alerts.visibleRepositoryIds(request.user);
    const [kindCounts, severityCounts, unavailable] = await Promise.all([
      Promise.all(
        kinds.map((kind) => this.prisma.securityAlert.count({ where: { AND: [visible, { kind, state: 'OPEN' }] } })),
      ),
      Promise.all(
        severities.map((severity) =>
          this.prisma.securityAlert.count({ where: { AND: [visible, { severity, state: 'OPEN' }] } }),
        ),
      ),
      this.prisma.securityAlertSyncState.findMany({
        distinct: ['repositoryId'],
        select: { repositoryId: true },
        where: {
          availability: 'UNAVAILABLE',
          ...(repositoryIds === undefined ? {} : { repositoryId: { in: repositoryIds } }),
        },
      }),
    ]);
    return {
      open: Object.fromEntries(kinds.map((kind, index) => [kind, kindCounts[index]])) as Record<
        SecurityAlertKind,
        number
      >,
      severity: Object.fromEntries(severities.map((severity, index) => [severity, severityCounts[index]])) as Record<
        SecurityAlertSeverity,
        number
      >,
      unavailableRepositories: unavailable.length,
    };
  }

  /**
   * Return distinct values for visible alert filters.
   *
   * @param request - Authenticated request.
   * @returns Permission-scoped repositories, metadata, and availability.
   */
  @Get('filter-options')
  @ApiOkResponse({ type: SecurityAlertFilterOptionsDto })
  async filterOptions(@Req() request: { user: AuthenticatedUser }): Promise<SecurityAlertFilterOptionsDto> {
    const ability = await this.alerts.getReadAbility(request.user);
    const items = await this.prisma.securityAlert.findMany({
      select: {
        ecosystem: true,
        manifest: true,
        packageName: true,
        ruleId: true,
        scanner: true,
        secretProvider: true,
        secretType: true,
        location: true,
        repository: { select: { id: true, name: true, owner: true } },
      },
      where: this.alerts.visibleWhere(ability),
    });
    const repositoryIds = await this.alerts.visibleRepositoryIds(request.user);
    const availability = await this.prisma.securityAlertSyncState.findMany({
      orderBy: [{ repositoryId: 'asc' }, { kind: 'asc' }],
      select: { availability: true, kind: true, lastSuccessfulSyncAt: true, reason: true, repositoryId: true },
      where: repositoryIds === undefined ? undefined : { repositoryId: { in: repositoryIds } },
    });
    /**
     * Collect distinct string values from one selected alert field.
     *
     * @param field - Field whose string values are collected.
     * @returns Sorted distinct values.
     */
    const values = (field: keyof (typeof items)[number]) =>
      [...new Set(items.flatMap((item) => (typeof item[field] === 'string' ? [item[field] as string] : [])))].sort();
    const repositories = [...new Map(items.map(({ repository }) => [repository.id, repository])).values()].sort(
      (left, right) => `${left.owner}/${left.name}`.localeCompare(`${right.owner}/${right.name}`),
    );
    const paths = [
      ...new Set(
        items.flatMap(({ location }) =>
          location &&
          typeof location === 'object' &&
          !Array.isArray(location) &&
          typeof (location as Record<string, unknown>).path === 'string'
            ? [(location as Record<string, string>).path]
            : [],
        ),
      ),
    ].sort();
    return {
      availability,
      ecosystems: values('ecosystem'),
      manifests: values('manifest'),
      packages: values('packageName'),
      paths,
      repositories,
      rules: values('ruleId'),
      scanners: values('scanner'),
      secretProviders: values('secretProvider'),
      secretTypes: values('secretType'),
    };
  }

  /**
   * Return one visible safe alert detail.
   *
   * @param request - Authenticated request.
   * @param id - Local alert identifier.
   * @returns Safe permission-scoped alert detail.
   */
  @Get(':id')
  @ApiOkResponse({ type: SecurityAlertDto })
  async findById(@Req() request: { user: AuthenticatedUser }, @Param('id') id: string): Promise<SecurityAlertDto> {
    const ability = await this.alerts.getReadAbility(request.user);
    return SecurityAlertDto.fromModel(
      await this.alerts.findById<SecurityAlertResourceModel>(id, { include: securityAlertInclude }, ability),
      true,
      ability,
    );
  }
}
