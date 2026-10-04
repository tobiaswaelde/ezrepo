import bcrypt from 'bcrypt';

import { resetPassword } from './password-reset.js';

describe('resetPassword', () => {
  const database = { user: { findUnique: jest.fn(), update: jest.fn() } };

  beforeEach(() => jest.clearAllMocks());

  it('replaces the hash and invalidates every access token for the user', async () => {
    database.user.findUnique.mockResolvedValue({ id: 'user-id' });

    await resetPassword(database, ' admin ', 'replacement-password');

    expect(database.user.findUnique).toHaveBeenCalledWith({ where: { username: 'admin' } });
    expect(database.user.update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { authVersion: { increment: 1 }, passwordHash: expect.any(String) },
    });
    const hash = database.user.update.mock.calls[0]?.[0].data.passwordHash as string;
    await expect(bcrypt.compare('replacement-password', hash)).resolves.toBe(true);
  });

  it('rejects an unknown user without modifying the database', async () => {
    database.user.findUnique.mockResolvedValue(null);

    await expect(resetPassword(database, 'missing', 'replacement-password')).rejects.toThrow('No local user found');
    expect(database.user.update).not.toHaveBeenCalled();
  });

  it('rejects an OIDC-managed account without creating a local credential', async () => {
    database.user.findUnique.mockResolvedValue({ authProvider: 'OIDC', id: 'oidc-user-id' });

    await expect(resetPassword(database, 'oidc-user', 'replacement-password')).rejects.toThrow(
      'OIDC-managed users do not have a local password',
    );
    expect(database.user.update).not.toHaveBeenCalled();
  });
});
