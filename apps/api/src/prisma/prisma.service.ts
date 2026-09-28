import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { ENV } from '../config/env.js';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

/** Injectable Prisma client with PostgreSQL adapter and transaction helpers. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy, OnModuleInit {
  /**
   * Initialize the Prisma client with the configured PostgreSQL adapter.
   *
   *
   */
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: ENV.DATABASE_URL }),
    });
  }

  /**
   * Connect the database client when Nest initializes the module.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * Disconnect the database client during graceful application shutdown.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Execute work inside an interactive database transaction.
   *
   * @param callback - Work receiving the transaction-scoped Prisma client; rejection rolls back the transaction.
   * @returns The value returned by the transaction callback.
   * @typeParam T - Result type preserved by this operation.
   */
  async transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(callback);
  }
}
