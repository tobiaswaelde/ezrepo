import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Open security-alert counters available only to managers and administrators. */
export class DashboardSecurityAlertSummaryDto {
  @ApiProperty() dependency!: number;
  @ApiProperty() code!: number;
  @ApiProperty() secret!: number;
  @ApiProperty() critical!: number;
  @ApiProperty() high!: number;
  @ApiProperty() medium!: number;
  @ApiProperty() low!: number;
  @ApiProperty() info!: number;
  @ApiProperty() unknown!: number;
}

/** Completed workflow-run counts grouped by normalized terminal status. */
export class DashboardStatusDistributionDto {
  @ApiProperty()
  success!: number;

  @ApiProperty()
  failed!: number;

  @ApiProperty()
  cancelled!: number;

  @ApiProperty()
  skipped!: number;

  @ApiProperty()
  unknown!: number;
}

/** Permission-aware workflow health summary for one requested period. */
export class DashboardSummaryDto {
  @ApiPropertyOptional({ type: DashboardSecurityAlertSummaryDto })
  securityAlerts?: DashboardSecurityAlertSummaryDto;
  @ApiProperty({ description: 'Number of visible runs currently awaiting provider approval.' })
  awaitingApprovalCount!: number;

  @ApiProperty({ description: 'Number of completed runs in the requested period.' })
  completedCount!: number;

  @ApiProperty({ description: 'Percentage of successful decided runs.', example: 94.2 })
  successRate!: number;

  @ApiProperty({ description: 'Median persisted duration of completed runs in milliseconds.', nullable: true })
  medianDurationMs!: number | null;

  @ApiProperty({ description: 'Total duration of all visible runs, including retained history, in milliseconds.' })
  totalRunDurationMs!: number;

  @ApiProperty({ description: 'Number of currently queued visible runs.' })
  queuedCount!: number;

  @ApiProperty({ description: 'Number of currently running visible runs.' })
  runningCount!: number;

  @ApiProperty({ type: DashboardStatusDistributionDto })
  statuses!: DashboardStatusDistributionDto;
}
