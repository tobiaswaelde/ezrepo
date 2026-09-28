import { Injectable } from '@nestjs/common';

import { ENV } from '../config/env.js';
import { PrismaService } from './prisma.service.js';

interface TableNameRow {
  tablename: string;
}

const PUBLIC_TABLES_QUERY = `
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  ORDER BY tablename
`;

/**
 * Build a deterministic cleanup statement that is safe to use only against a test database.
 *
 * @param databaseUrl - PostgreSQL URL of the database being cleaned.
 * @param tableNames - Application table names discovered from PostgreSQL.
 * @returns A truncate statement, or null when the schema contains no application tables.
 * @throws Error - When the URL does not point to a database ending in `_test`.
 */
export function buildTestDatabaseCleanupStatement(databaseUrl: string, tableNames: string[]): string | null {
  const databaseName = new URL(databaseUrl).pathname.slice(1);

  if (!databaseName.endsWith('_test')) {
    throw new Error('Refusing database cleanup because DATABASE_URL does not target a test database.');
  }

  if (tableNames.length === 0) {
    return null;
  }

  const tables = [...tableNames]
    .sort((left, right) => left.localeCompare(right))
    .map((tableName) => `"${tableName.replaceAll('"', '""')}"`)
    .join(', ');

  return `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`;
}

/** Clears all application tables between integration tests. */
@Injectable()
export class TestDatabaseService {
  /**
   * Initialize TestDatabaseService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Remove all application data while preserving Prisma migration metadata.
   *
   * @returns A promise that resolves when the operation completes.
   * @throws Error - When the configured database name does not end in `_test`.
   */
  async cleanup(): Promise<void> {
    if (!ENV.isTest) {
      throw new Error('Refusing database cleanup outside NODE_ENV=test.');
    }

    const rows = await this.prisma.$queryRawUnsafe<TableNameRow[]>(PUBLIC_TABLES_QUERY);
    const statement = buildTestDatabaseCleanupStatement(
      ENV.DATABASE_URL,
      rows.map(({ tablename }) => tablename),
    );

    if (statement) {
      await this.prisma.$executeRawUnsafe(statement);
    }
  }
}
