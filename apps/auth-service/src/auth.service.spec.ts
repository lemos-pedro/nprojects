import { ConflictException, UnauthorizedException } from '@nestjs/common';

import { AuthService } from './auth.service';
import { generateTotpCode } from './totp.util';

describe('AuthService', () => {
  let service: AuthService;

  beforeAll(() => {
    delete process.env.POSTGRES_HOST;
  });

  beforeEach(() => {
    service = new AuthService();
  });

  it('registers and logs in a user', async () => {
    await service.register({
      email: 'admin@ngola.dev',
      password: 'super-secret',
      fullName: 'Ngola Admin',
    });

    const result = await service.login({
      email: 'admin@ngola.dev',
      password: 'super-secret',
    });

    expect(result.user.email).toBe('admin@ngola.dev');
    expect(result.tokens.accessToken).toBeDefined();
    expect(result.tokens.refreshToken).toBeDefined();
  });

  it('returns the authenticated user from an access token', async () => {
    await service.register({
      email: 'admin@ngola.dev',
      password: 'super-secret',
      fullName: 'Ngola Admin',
    });

    const result = await service.login({
      email: 'admin@ngola.dev',
      password: 'super-secret',
    });

    await expect(service.getUserFromAccessToken(result.tokens.accessToken)).resolves.toMatchObject({
      email: 'admin@ngola.dev',
    });
  });

  it('rejects duplicate registration', async () => {
    await service.register({
      email: 'admin@ngola.dev',
      password: 'super-secret',
      fullName: 'Ngola Admin',
    });

    await expect(
      service.register({
        email: 'admin@ngola.dev',
        password: 'another-secret',
        fullName: 'Ngola Admin',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects invalid credentials', async () => {
    await service.register({
      email: 'admin@ngola.dev',
      password: 'super-secret',
      fullName: 'Ngola Admin',
    });

    await expect(
      service.login({
        email: 'admin@ngola.dev',
        password: 'invalid',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('enables and verifies two-factor authentication', async () => {
    const registration = await service.register({
      email: 'admin@ngola.dev',
      password: 'super-secret',
      fullName: 'Ngola Admin',
    });

    const setup = await service.enableTwoFactor(registration.user.id);
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    const validCode = generateTotpCode(setup.secret);

    await expect(service.verifyTwoFactor(registration.user.id, validCode)).resolves.toMatchObject({
      verified: true,
      twoFactorEnabled: true,
    });
  });

  it('creates short invite codes and adds accepted members to the team', async () => {
    const owner = await service.register({
      email: 'owner@ngola.dev',
      password: 'super-secret',
      fullName: 'Owner User',
    });

    const invite = await service.createTeamInviteLink(owner.user, {
      teamName: 'Product Team',
      email: 'member@ngola.dev',
      role: 'member',
    });

    expect(invite.token).toMatch(/^\d{8}$/);
    expect(invite.inviteCode).toBe(invite.token);

    const joined = await service.joinTeamByInviteToken(invite.token, {
      email: 'member@ngola.dev',
      fullName: 'Member User',
      password: 'member-secret',
    });

    expect(joined).toMatchObject({
      accepted: true,
      teamName: 'Product Team',
      role: 'member',
    });

    await expect(service.getUsersByTenant(owner.user.tenantId, invite.teamId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'owner@ngola.dev' }),
        expect.objectContaining({ email: 'member@ngola.dev' }),
      ]),
    );

    await expect(service.getTeamMembers(owner.user, invite.teamId)).resolves.toMatchObject({
      teamId: invite.teamId,
      members: expect.arrayContaining([
        expect.objectContaining({ email: 'owner@ngola.dev', role: 'owner' }),
        expect.objectContaining({ email: 'member@ngola.dev', role: 'member' }),
      ]),
    });
  });
});
