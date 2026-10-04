import { AuthController } from './auth.controller.js';

describe('AuthController', () => {
  it('exposes first-run setup status without an authenticated user', async () => {
    const auth = { getSetupStatus: jest.fn().mockResolvedValue({ initialized: false }) };
    const controller = new AuthController(auth as never, {} as never);

    await expect(controller.setupStatus()).resolves.toEqual({ initialized: false });
  });

  it('creates the first administrator through the setup service', async () => {
    const result = {
      accessToken: 'jwt',
      user: { authProvider: 'LOCAL' as const, id: 'admin-id', role: 'SYSTEM_ADMIN', username: 'admin' },
    };
    const auth = { setup: jest.fn().mockResolvedValue(result) };
    const controller = new AuthController(auth as never, {} as never);
    const input = { firstName: 'Vera', password: 'secure-password', username: 'admin' };

    await expect(controller.setup(input)).resolves.toEqual(result);
    expect(auth.setup).toHaveBeenCalledWith(input);
  });

  it('returns the replacement session after changing the current password', async () => {
    const result = {
      accessToken: 'replacement',
      user: { authProvider: 'LOCAL' as const, id: 'user-id', role: 'VIEWER', username: 'viewer' },
    };
    const auth = { updatePassword: jest.fn().mockResolvedValue(result) };
    const controller = new AuthController(auth as never, {} as never);
    const input = { currentPassword: 'current-password', newPassword: 'replacement-password' };

    await expect(
      controller.updatePassword(
        { user: { authProvider: 'LOCAL' as const, id: 'user-id', role: 'VIEWER', username: 'viewer' } },
        input,
      ),
    ).resolves.toEqual(result);
    expect(auth.updatePassword).toHaveBeenCalledWith('user-id', 'current-password', 'replacement-password');
  });

  it('updates only the currently authenticated user profile', async () => {
    const updated = {
      avatarUpdatedAt: null,
      firstName: 'Vera',
      id: 'user-id',
      lastName: 'Viewer',
      role: 'VIEWER' as const,
      username: 'renamed',
    };
    const auth = { updateProfile: jest.fn().mockResolvedValue(updated) };
    const controller = new AuthController(auth as never, {} as never);
    const input = {
      currentPassword: 'current-password',
      firstName: 'Vera',
      lastName: 'Viewer',
      username: 'renamed',
    };

    await expect(
      controller.updateProfile(
        { user: { authProvider: 'LOCAL' as const, id: 'user-id', role: 'VIEWER', username: 'viewer' } },
        input,
      ),
    ).resolves.toEqual(updated);
    expect(auth.updateProfile).toHaveBeenCalledWith('user-id', input);
  });
});
