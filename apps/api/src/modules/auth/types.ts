import type { AuthProvider, UserRole } from '../../generated/prisma/client.js';

export interface AuthenticatedUser {
  authProvider: AuthProvider;
  avatarUpdatedAt?: Date | null;
  firstName?: string | null;
  id: string;
  lastName?: string | null;
  role: UserRole;
  username: string;
}

export interface AuthResult {
  accessToken: string;
  user: AuthenticatedUser;
}
