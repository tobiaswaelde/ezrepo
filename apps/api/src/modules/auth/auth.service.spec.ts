import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';

import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  const prisma = {
    user: {
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    transaction: jest.fn(),
  };
  const jwt = { signAsync: jest.fn(), verifyAsync: jest.fn() };
  const service = new AuthService(prisma as never, jwt as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects invalid local credentials', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.signIn('unknown', 'password')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('issues a JWT for valid credentials', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-id',
      authVersion: 3,
      avatar: null,
      firstName: null,
      lastName: null,
      passwordHash: await bcrypt.hash('password', 4),
      role: 'VIEWER',
      username: 'viewer',
    });
    jwt.signAsync.mockResolvedValue('jwt');

    await expect(service.signIn('viewer', 'password')).resolves.toEqual({
      accessToken: 'jwt',
      user: {
        avatarUpdatedAt: null,
        firstName: null,
        id: 'user-id',
        lastName: null,
        role: 'VIEWER',
        username: 'viewer',
      },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ authVersion: 3, sub: 'user-id', username: 'viewer' }),
    );
  });

  it('authenticates a valid access token against the current persisted user', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-id' });
    prisma.user.findUnique.mockResolvedValue({
      avatar: null,
      authVersion: 0,
      firstName: 'Mara',
      id: 'user-id',
      lastName: 'Manager',
      role: 'MANAGER',
      username: 'manager',
    });

    await expect(service.authenticateAccessToken('jwt')).resolves.toEqual({
      avatarUpdatedAt: null,
      firstName: 'Mara',
      id: 'user-id',
      lastName: 'Manager',
      role: 'MANAGER',
      username: 'manager',
    });
  });

  it('rejects an access token issued before the latest password change', async () => {
    jwt.verifyAsync.mockResolvedValue({ authVersion: 1, sub: 'user-id' });
    prisma.user.findUnique.mockResolvedValue({ authVersion: 2 });

    await expect(service.authenticateAccessToken('stale')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a legacy token only while the persisted auth version is zero', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-id' });
    prisma.user.findUnique.mockResolvedValue({
      authVersion: 0,
      avatar: null,
      firstName: null,
      id: 'user-id',
      lastName: null,
      role: 'VIEWER',
      username: 'viewer',
    });

    await expect(service.authenticateAccessToken('legacy')).resolves.toMatchObject({ id: 'user-id' });
  });

  it('reports the persisted first-run setup state', async () => {
    prisma.user.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await expect(service.getSetupStatus()).resolves.toEqual({ initialized: false });
    await expect(service.getSetupStatus()).resolves.toEqual({ initialized: true });
  });

  it('creates and signs in the first system administrator', async () => {
    const transaction = {
      $executeRaw: jest.fn(),
      user: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
    };
    transaction.user.create.mockResolvedValue({
      authVersion: 0,
      firstName: 'Vera',
      id: 'admin-id',
      lastName: null,
      role: 'SYSTEM_ADMIN',
      username: 'admin',
    });
    prisma.transaction.mockImplementation((callback) => callback(transaction));
    jwt.signAsync.mockResolvedValue('setup-token');

    await expect(
      service.setup({ firstName: ' Vera ', lastName: ' ', password: 'new-password', username: ' admin ' }),
    ).resolves.toMatchObject({ accessToken: 'setup-token', user: { firstName: 'Vera', role: 'SYSTEM_ADMIN' } });
    expect(transaction.$executeRaw).toHaveBeenCalled();
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ firstName: 'Vera', lastName: null, role: 'SYSTEM_ADMIN', username: 'admin' }),
    });
  });

  it('rejects setup after any user exists', async () => {
    const transaction = {
      $executeRaw: jest.fn(),
      user: { count: jest.fn().mockResolvedValue(1), create: jest.fn() },
    };
    prisma.transaction.mockImplementation((callback) => callback(transaction));

    await expect(service.setup({ password: 'new-password', username: 'admin' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transaction.user.create).not.toHaveBeenCalled();
  });

  it('changes a password, increments the auth version, and returns a replacement token', async () => {
    const passwordHash = await bcrypt.hash('current-password', 4);
    prisma.user.findUnique.mockResolvedValue({ id: 'user-id', passwordHash });
    prisma.user.update.mockResolvedValue({
      authVersion: 5,
      avatar: null,
      firstName: null,
      id: 'user-id',
      lastName: null,
      role: 'VIEWER',
      username: 'viewer',
    });
    jwt.signAsync.mockResolvedValue('replacement-token');

    await expect(service.updatePassword('user-id', 'current-password', 'new-long-password')).resolves.toMatchObject({
      accessToken: 'replacement-token',
      user: { id: 'user-id' },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { authVersion: { increment: 1 }, passwordHash: expect.any(String) },
      include: { avatar: { select: { updatedAt: true } } },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ authVersion: 5 }));
  });

  it('rejects an incorrect current password without changing it', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-id',
      passwordHash: await bcrypt.hash('current-password', 4),
    });

    await expect(service.updatePassword('user-id', 'incorrect-password', 'new-long-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects local password changes for an OIDC-managed account', async () => {
    prisma.user.findUnique.mockResolvedValue({ authProvider: 'OIDC', id: 'user-id', passwordHash: null });

    await expect(service.updatePassword('user-id', 'current-password', 'new-long-password')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid access token', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('invalid token'));

    await expect(service.authenticateAccessToken('invalid')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('updates trimmed personal names without requiring a password', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-id', passwordHash: 'hash', username: 'viewer' });
    prisma.user.update.mockResolvedValue({
      avatar: null,
      firstName: 'Vera',
      id: 'user-id',
      lastName: null,
      role: 'VIEWER',
      username: 'viewer',
    });

    await expect(
      service.updateProfile('user-id', {
        firstName: ' Vera ',
        lastName: ' ',
        username: 'viewer',
      }),
    ).resolves.toEqual({
      avatarUpdatedAt: null,
      firstName: 'Vera',
      id: 'user-id',
      lastName: null,
      role: 'VIEWER',
      username: 'viewer',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { firstName: 'Vera', lastName: null, username: 'viewer' },
      include: { avatar: { select: { updatedAt: true } } },
    });
  });

  it('rejects local profile changes for an OIDC-managed account', async () => {
    prisma.user.findUnique.mockResolvedValue({ authProvider: 'OIDC', id: 'user-id', username: 'oidc_user' });

    await expect(
      service.updateProfile('user-id', { firstName: 'Changed', lastName: null, username: 'oidc_user' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('requires the current password before changing the login username', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-id', passwordHash: 'hash', username: 'viewer' });

    await expect(
      service.updateProfile('user-id', {
        firstName: null,
        lastName: null,
        username: 'renamed',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an incorrect password before changing the login username', async () => {
    const passwordHash = await bcrypt.hash('current-password', 4);
    prisma.user.findUnique.mockResolvedValue({ id: 'user-id', passwordHash, username: 'viewer' });

    await expect(
      service.updateProfile('user-id', {
        currentPassword: 'incorrect-password',
        firstName: null,
        lastName: null,
        username: 'renamed',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('changes the login username after verifying the current password', async () => {
    const passwordHash = await bcrypt.hash('current-password', 4);
    prisma.user.findUnique.mockResolvedValue({ id: 'user-id', passwordHash, username: 'viewer' });
    prisma.user.update.mockResolvedValue({
      avatar: null,
      firstName: 'Vera',
      id: 'user-id',
      lastName: 'Viewer',
      role: 'VIEWER',
      username: 'renamed',
    });

    await expect(
      service.updateProfile('user-id', {
        currentPassword: 'current-password',
        firstName: 'Vera',
        lastName: 'Viewer',
        username: 'renamed',
      }),
    ).resolves.toMatchObject({ firstName: 'Vera', lastName: 'Viewer', username: 'renamed' });
  });
});
