import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { filterCaslFields } from '@querry-kit/nest/casl';

import { CaslAction } from '../../../casl/casl-action.js';
import { CaslSubject } from '../../../casl/casl-subject.js';
import type { AppAbility } from '../../../casl/types.js';
import type { ProviderAccount, Repository, SecurityAlert } from '../../../generated/prisma/client.js';

export type SecurityAlertResourceModel = SecurityAlert & {
  repository: Pick<Repository, 'name' | 'owner'> & {
    providerAccount: Pick<ProviderAccount, 'providerType'>;
  };
};

/** Safe normalized security-alert representation. */
export class SecurityAlertDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() kind!: SecurityAlert['kind'];
  @ApiProperty() state!: SecurityAlert['state'];
  @ApiProperty() severity!: SecurityAlert['severity'];
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty({ type: [String] }) identifiers!: string[];
  @ApiPropertyOptional({ nullable: true }) scanner!: string | null;
  @ApiProperty({ format: 'date-time' }) providerCreatedAt!: Date;
  @ApiProperty({ format: 'date-time' }) providerUpdatedAt!: Date;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) resolvedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) resolution!: string | null;
  @ApiProperty({ format: 'uri' }) providerUrl!: string;
  @ApiPropertyOptional({ nullable: true }) packageName!: string | null;
  @ApiPropertyOptional({ nullable: true }) ecosystem!: string | null;
  @ApiPropertyOptional({ nullable: true }) manifest!: string | null;
  @ApiPropertyOptional({ nullable: true }) vulnerableRange!: string | null;
  @ApiPropertyOptional({ nullable: true }) fixedVersion!: string | null;
  @ApiPropertyOptional({ nullable: true }) ruleId!: string | null;
  @ApiPropertyOptional({ nullable: true }) tool!: string | null;
  @ApiPropertyOptional({ nullable: true }) secretType!: string | null;
  @ApiPropertyOptional({ nullable: true }) secretProvider!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Object }) location!: unknown;
  @ApiProperty({ format: 'uuid' }) repositoryId!: string;
  @ApiProperty() repositoryOwner!: string;
  @ApiProperty() repositoryName!: string;
  @ApiProperty() providerType!: ProviderAccount['providerType'];

  /**
   * Project explicitly safe normalized fields, optionally including detail text.
   *
   * @param model - Persisted normalized alert with repository metadata.
   * @param includeDescription - Whether to expose the safe normalized description.
   * @param ability - Optional ability used for field-level filtering.
   * @returns Safe public security-alert DTO.
   */
  static fromModel(
    model: SecurityAlertResourceModel,
    includeDescription = false,
    ability?: AppAbility,
  ): SecurityAlertDto {
    return filterCaslFields(
      {
        ecosystem: model.ecosystem,
        fixedVersion: model.fixedVersion,
        id: model.id,
        identifiers: model.identifiers,
        kind: model.kind,
        location: model.location,
        manifest: model.manifest,
        packageName: model.packageName,
        providerCreatedAt: model.providerCreatedAt,
        providerType: model.repository.providerAccount.providerType,
        providerUpdatedAt: model.providerUpdatedAt,
        providerUrl: model.providerUrl,
        repositoryId: model.repositoryId,
        repositoryName: model.repository.name,
        repositoryOwner: model.repository.owner,
        resolution: model.resolution,
        resolvedAt: model.resolvedAt,
        ruleId: model.ruleId,
        scanner: model.scanner,
        secretProvider: model.secretProvider,
        secretType: model.secretType,
        severity: model.severity,
        state: model.state,
        title: model.title,
        tool: model.tool,
        vulnerableRange: model.vulnerableRange,
        ...(includeDescription ? { description: model.description } : {}),
      },
      CaslSubject.SecurityAlert,
      ability,
      { action: CaslAction.Read },
    );
  }
}

/** Permission-scoped open alert and availability counters. */
export class SecurityAlertSummaryDto {
  @ApiProperty({ type: Object }) open!: Record<SecurityAlert['kind'], number>;
  @ApiProperty({ type: Object }) severity!: Record<SecurityAlert['severity'], number>;
  @ApiProperty() unavailableRepositories!: number;
}

/** Visible repositories and kind-specific values used by alert filters. */
export class SecurityAlertFilterOptionsDto {
  @ApiProperty({ type: [Object] }) repositories!: Array<{ id: string; name: string; owner: string }>;
  @ApiProperty({ type: [String] }) ecosystems!: string[];
  @ApiProperty({ type: [String] }) packages!: string[];
  @ApiProperty({ type: [String] }) manifests!: string[];
  @ApiProperty({ type: [String] }) scanners!: string[];
  @ApiProperty({ type: [String] }) rules!: string[];
  @ApiProperty({ type: [String] }) paths!: string[];
  @ApiProperty({ type: [String] }) secretTypes!: string[];
  @ApiProperty({ type: [String] }) secretProviders!: string[];
  @ApiProperty({ type: [Object] })
  availability!: Array<{
    availability: string;
    kind: string;
    lastSuccessfulSyncAt: Date | null;
    reason: string | null;
    repositoryId: string;
  }>;
}
