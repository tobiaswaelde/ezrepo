import { McpServer, type JSONValue } from '@modelcontextprotocol/server';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedUser } from '../auth/types.js';
import { McpToolsService } from './mcp-tools.service.js';

const providerTypeSchema = z.enum(['GITHUB', 'GITLAB', 'FORGEJO', 'GITEA']);
const workflowStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED', 'UNKNOWN']);
const paginationSchema = {
  limit: z.number().int().min(1).max(100).default(25),
  page: z.number().int().min(1).default(1),
};
const repositoryFiltersSchema = z.object({
  ...paginationSchema,
  enabled: z.boolean().optional(),
  providerType: providerTypeSchema.optional(),
  search: z.string().trim().min(1).max(1024).optional(),
});
const workflowRunFiltersSchema = z.object({
  ...paginationSchema,
  from: z.iso.datetime({ offset: true }).optional(),
  providerType: providerTypeSchema.optional(),
  repositoryId: z.uuid().optional(),
  search: z.string().trim().min(1).max(1024).optional(),
  status: workflowStatusSchema.optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
const repositorySchema = z.object({
  enabled: z.boolean(),
  id: z.string(),
  issueRetentionDays: z.number().nullable(),
  lastSyncAt: z.string().nullable(),
  name: z.string(),
  owner: z.string(),
  providerAccountId: z.string(),
  providerRepositoryId: z.string(),
  pullRequestRetentionDays: z.number().nullable(),
  url: z.string(),
  workflowRunCount: z.number().optional(),
  workflowRunRetentionDays: z.number().nullable(),
});
const workflowRunSchema = z.object({
  completedAt: z.string().nullable(),
  displayTitle: z.string(),
  durationMs: z.number().nullable(),
  id: z.string(),
  providerCreatedAt: z.string(),
  providerRunId: z.string(),
  providerType: providerTypeSchema,
  repositoryId: z.string(),
  repositoryName: z.string(),
  repositoryOwner: z.string(),
  startedAt: z.string().nullable(),
  status: workflowStatusSchema,
  url: z.string(),
  workflowName: z.string(),
});
const dashboardRunSchema = z.object({
  awaitingApproval: z.boolean(),
  completedAt: z.string().nullable(),
  displayTitle: z.string(),
  durationMs: z.number().nullable(),
  id: z.string(),
  provider: z.object({ displayName: z.string(), id: z.string(), providerType: providerTypeSchema }),
  providerCreatedAt: z.string(),
  providerRunId: z.string(),
  repository: z.object({ id: z.string(), name: z.string(), owner: z.string(), url: z.string() }),
  reviewUrl: z.string().nullable(),
  startedAt: z.string().nullable(),
  status: workflowStatusSchema,
  url: z.string(),
  workflowName: z.string(),
});
const paginatedRepositorySchema = z.object({
  items: z.array(repositorySchema),
  page: z.number(),
  perPage: z.number(),
  total: z.number(),
});
const paginatedWorkflowRunSchema = z.object({
  items: z.array(workflowRunSchema),
  page: z.number(),
  perPage: z.number(),
  total: z.number(),
});
const paginatedDashboardRunSchema = z.object({
  items: z.array(dashboardRunSchema),
  page: z.number(),
  perPage: z.number(),
  total: z.number(),
});
const dashboardPeriodSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});
const dashboardSummarySchema = z.object({
  awaitingApprovalCount: z.number(),
  completedCount: z.number(),
  medianDurationMs: z.number().nullable(),
  queuedCount: z.number(),
  runningCount: z.number(),
  statuses: z.object({
    cancelled: z.number(),
    failed: z.number(),
    skipped: z.number(),
    success: z.number(),
    unknown: z.number(),
  }),
  successRate: z.number(),
  totalRunDurationMs: z.number(),
});
const trendSchema = z.object({
  buckets: z.array(z.object({ bucketStart: z.string(), errorCount: z.number(), successCount: z.number() })),
});
const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
};

/** Creates a fresh permission-bound MCP server for every stateless HTTP request. */
@Injectable()
export class McpServerFactory {
  /**
   * Initialize McpServerFactory with its required dependencies.
   *
   * @param tools - Permission-scoped implementations of the exposed MCP tools.
   */
  constructor(private readonly tools: McpToolsService) {}

  /**
   * Build the exact read-only tool catalog available to one authenticated user.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @returns A fresh MCP server whose read-only tools are bound to the supplied user.
   */
  create(user: AuthenticatedUser): McpServer {
    const server = new McpServer({ name: 'ezrepo', version: '1.0.0' });

    server.registerTool(
      'list_repositories',
      {
        annotations: readOnlyAnnotations,
        description: 'List tracked repositories visible to the current ezRepo user.',
        inputSchema: repositoryFiltersSchema,
        outputSchema: paginatedRepositorySchema,
        title: 'List repositories',
      },
      async (input) => this.result(await this.tools.listRepositories(user, input)),
    );
    server.registerTool(
      'get_repository',
      {
        annotations: readOnlyAnnotations,
        description: 'Get one tracked repository when it is visible to the current ezRepo user.',
        inputSchema: z.object({ repositoryId: z.uuid() }),
        outputSchema: repositorySchema,
        title: 'Get repository',
      },
      async ({ repositoryId }) => this.result(await this.tools.getRepository(user, repositoryId)),
    );
    server.registerTool(
      'list_workflow_runs',
      {
        annotations: readOnlyAnnotations,
        description: 'List normalized workflow runs visible to the current ezRepo user.',
        inputSchema: workflowRunFiltersSchema,
        outputSchema: paginatedWorkflowRunSchema,
        title: 'List workflow runs',
      },
      async (input) => this.result(await this.tools.listWorkflowRuns(user, input)),
    );
    server.registerTool(
      'list_needs_attention',
      {
        annotations: readOnlyAnnotations,
        description: 'List visible workflow contexts whose newest terminal run failed.',
        inputSchema: workflowRunFiltersSchema,
        outputSchema: paginatedWorkflowRunSchema,
        title: 'List workflow runs needing attention',
      },
      async (input) => this.result(await this.tools.listNeedsAttention(user, input)),
    );
    server.registerTool(
      'list_awaiting_approval',
      {
        annotations: readOnlyAnnotations,
        description: 'List visible current workflow runs waiting for provider approval.',
        inputSchema: workflowRunFiltersSchema,
        outputSchema: paginatedDashboardRunSchema,
        title: 'List workflow runs awaiting approval',
      },
      async (input) => this.result(await this.tools.listAwaitingApproval(user, input)),
    );
    server.registerTool(
      'get_dashboard_summary',
      {
        annotations: readOnlyAnnotations,
        description: 'Summarize visible workflow health for an inclusive time period.',
        inputSchema: dashboardPeriodSchema,
        outputSchema: dashboardSummarySchema,
        title: 'Get dashboard summary',
      },
      async ({ from, to }) => this.result(await this.tools.getDashboardSummary(user, from, to)),
    );
    server.registerTool(
      'get_workflow_trend',
      {
        annotations: readOnlyAnnotations,
        description: 'Aggregate visible successful and failed workflow runs into UTC trend buckets.',
        inputSchema: dashboardPeriodSchema.extend({ bucket: z.enum(['hour', 'day', 'week']).default('day') }),
        outputSchema: trendSchema,
        title: 'Get workflow trend',
      },
      async ({ bucket, from, to }) =>
        this.result({ buckets: await this.tools.getWorkflowTrend(user, from, to, bucket) }),
    );

    return server;
  }

  /**
   * Serialize a tool result into both MCP text content and structured JSON content.
   *
   * @param value - JSON-serializable result returned by a permission-scoped MCP tool.
   * @returns Equivalent text and structured JSON representations of the tool result.
   */
  private result(value: unknown): { content: [{ text: string; type: 'text' }]; structuredContent: JSONValue } {
    const structuredContent = JSON.parse(JSON.stringify(value)) as JSONValue;
    return { content: [{ text: JSON.stringify(structuredContent), type: 'text' }], structuredContent };
  }
}
