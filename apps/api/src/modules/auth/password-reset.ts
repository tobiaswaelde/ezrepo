import bcrypt from 'bcrypt';

interface PasswordResetDatabase {
  user: {
    /**
     * Find the local user whose password will be reset.
     *
     * @param input - Input values used to validate and perform the operation.
     * @returns The matching local user ID, or null when the login does not exist.
     */
    findUnique(input: { where: { username: string } }): Promise<{ id: string } | null>;
    /**
     * Replace the password hash and increment the local user authentication version.
     *
     * @param input - Input values used to validate and perform the operation.
     * @returns The database update result.
     */
    update(input: {
      data: { authVersion: { increment: number }; passwordHash: string };
      where: { id: string };
    }): Promise<unknown>;
  };
}

/**
 * Reset one local user's password and invalidate every issued access token.
 *
 * @param database - Prisma-compatible user persistence.
 * @param username - Exact local login username.
 * @param password - Replacement password with at least twelve characters.
 * @returns A promise that resolves when the operation completes.
 * @throws Error - When the input is invalid or the user does not exist.
 */
export async function resetPassword(
  database: PasswordResetDatabase,
  username: string,
  password: string,
): Promise<void> {
  const normalizedUsername = username.trim();
  if (!normalizedUsername || password.length < 12 || password.length > 256) {
    throw new Error('A username and a password between 12 and 256 characters are required.');
  }

  const user = await database.user.findUnique({ where: { username: normalizedUsername } });
  if (!user) throw new Error('No local user found for that username.');

  await database.user.update({
    where: { id: user.id },
    data: { authVersion: { increment: 1 }, passwordHash: await bcrypt.hash(password, 12) },
  });
}
