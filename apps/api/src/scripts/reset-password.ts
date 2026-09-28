import { stdin, stdout } from 'node:process';

import { resetPassword } from '../modules/auth/password-reset.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Read the replacement password from standard input without logging it.
 *
 * @returns The password supplied on standard input with trailing line endings removed.
 */
async function readPassword(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

/**
 * Reset a local account password from command-line input and close the database connection.
 *
 * @returns A promise that resolves when the operation completes.
 * @throws Error - Usage: printf "password\n" | node dist/scripts/reset-password.js <username>
 */
async function main(): Promise<void> {
  const username = process.argv[2]?.trim();
  if (!username) throw new Error('Usage: printf "password\\n" | node dist/scripts/reset-password.js <username>');

  const password = await readPassword();
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await resetPassword(prisma, username, password);
  } finally {
    await prisma.$disconnect();
  }
  stdout.write('Password changed and all existing sessions invalidated.\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
