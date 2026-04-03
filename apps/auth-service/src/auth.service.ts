import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { PoolClient } from 'pg';
import { createHmac, randomUUID } from 'crypto';
import axios from 'axios';

import { query, isPostgresEnabled, withTransaction } from '@ngola/database';

import {
  AuthSession,
  AuthTokens,
  AuthUser,
  LoginPayload,
  RegisterPayload,
} from './auth.types';
import { buildOtpAuthUrl, generateTotpSecret, verifyTotpCode } from './totp.util';

export type SafeAuthUser = Omit<AuthUser, 'passwordHash' | 'twoFactorSecret' | 'pendingTwoFactorSecret'>;

interface DatabaseUserRow {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  password_hash: string;
  two_factor_enabled: boolean;
  two_factor_secret: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

type InviteRole = 'admin' | 'manager' | 'member' | 'viewer' | 'guest';

interface TeamInvitePayload {
  teamId?: string;
  teamName?: string;
  description?: string;
  email?: string;
  role?: InviteRole;
  expiresInDays?: number;
}

interface JoinTeamByInvitePayload {
  email?: string;
  fullName?: string;
  password?: string;
}

interface MemoryTeamInvite {
  token: string;
  tenantId: string;
  invitedBy: string;
  teamId: string;
  teamName: string;
  email?: string;
  role: InviteRole;
  expiresAt: string;
  acceptedAt?: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly usePostgres = isPostgresEnabled();
  private readonly users = new Map<string, AuthUser>();
  private readonly sessions = new Map<string, AuthSession>();
  private readonly accessSecret = process.env.AUTH_JWT_ACCESS_SECRET ?? 'dev-access-secret';
  private readonly refreshSecret = process.env.AUTH_JWT_REFRESH_SECRET ?? 'dev-refresh-secret';
  private readonly accessTtl = Number(process.env.AUTH_ACCESS_TOKEN_TTL ?? 900);
  private readonly refreshTtl = Number(process.env.AUTH_REFRESH_TOKEN_TTL ?? 604800);
  private readonly teamInvites = new Map<string, MemoryTeamInvite>();
  private readonly memoryTeams = new Map<
    string,
    { id: string; tenantId: string; name: string; description?: string; createdBy: string }
  >();

  async register(payload: RegisterPayload): Promise<SafeAuthUser> {
    if (!payload.email || !payload.password || !payload.fullName) {
      throw new BadRequestException('email, password and fullName are required');
    }

    if (this.usePostgres) {
      return this.registerWithPostgres(payload);
    }

    const email = payload.email.trim().toLowerCase();

    if ([...this.users.values()].some(user => user.email === email)) {
      throw new ConflictException('email already registered');
    }

    const user: AuthUser = {
      id: randomUUID(),
      tenantId: randomUUID(),
      email,
      fullName: payload.fullName.trim(),
      passwordHash: await hash(payload.password, 12),
      twoFactorEnabled: false,
      createdAt: new Date().toISOString(),
    };

    this.users.set(user.id, user);
    return this.sanitizeUser(user);
  }

  async login(payload: LoginPayload): Promise<{ user: SafeAuthUser; tokens: AuthTokens }> {
    if (!payload.email || !payload.password) {
      throw new BadRequestException('email and password are required');
    }

    const user = this.usePostgres
      ? await this.findUserByEmail(payload.email)
      : [...this.users.values()].find(
          currentUser => currentUser.email === payload.email.trim().toLowerCase(),
        );

    if (!user || !(await compare(payload.password, user.passwordHash))) {
      throw new UnauthorizedException('invalid credentials');
    }

    if (user.twoFactorEnabled) {
      if (!payload.twoFactorCode) {
        throw new UnauthorizedException('two-factor code required');
      }

      if (!user.twoFactorSecret || !verifyTotpCode(user.twoFactorSecret, payload.twoFactorCode)) {
        throw new UnauthorizedException('invalid two-factor code');
      }
    }

    const tokens = await this.issueTokens(user.id);
    return { user: this.sanitizeUser(user), tokens };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    if (!refreshToken) {
      throw new BadRequestException('refresh token is required');
    }

    if (this.usePostgres) {
      const result = await query<{ user_id: string; expires_at: string }>(
        `SELECT user_id, expires_at
         FROM user_sessions
         WHERE refresh_token = $1 AND revoked_at IS NULL
         LIMIT 1`,
        [refreshToken],
      );
      const session = result.rows[0];

      if (!session || new Date(session.expires_at).getTime() < Date.now()) {
        throw new UnauthorizedException('refresh token expired or invalid');
      }

      await query('DELETE FROM user_sessions WHERE refresh_token = $1', [refreshToken]);
      return this.issueTokens(session.user_id);
    }

    const session = this.sessions.get(refreshToken);

    if (!session || session.expiresAt < Date.now()) {
      throw new UnauthorizedException('refresh token expired or invalid');
    }

    this.sessions.delete(refreshToken);
    return this.issueTokens(session.userId);
  }

  async logout(refreshToken: string): Promise<{ revoked: boolean }> {
    if (!refreshToken) {
      throw new BadRequestException('refresh token is required');
    }

    if (this.usePostgres) {
      const result = await query('DELETE FROM user_sessions WHERE refresh_token = $1', [refreshToken]);
      return { revoked: Boolean(result.rowCount) };
    }

    return { revoked: this.sessions.delete(refreshToken) };
  }

  async getProfile(userId: string): Promise<SafeAuthUser> {
    const user = this.usePostgres ? await this.findUserById(userId) : this.requireUser(userId);
    return this.sanitizeUser(user);
  }

  async getUsers(tenantId: string): Promise<SafeAuthUser[]> {
    if (this.usePostgres) {
      const result = await query<DatabaseUserRow>(
        `SELECT id, tenant_id, email, full_name, password_hash, two_factor_enabled, two_factor_secret, metadata, created_at
         FROM users
         WHERE tenant_id = $1
         ORDER BY created_at ASC`,
        [tenantId],
      );

      return result.rows.map(row => this.sanitizeUser(this.mapDatabaseUser(row)));
    }

    return [...this.users.values()]
      .filter(user => user.tenantId === tenantId)
      .map(user => this.sanitizeUser(user));
  }

  async createTeamInviteLink(currentUser: SafeAuthUser, payload: TeamInvitePayload) {
    const role = this.normalizeInviteRole(payload.role);
    const requestedTeamName = payload.teamName?.trim();
    const expiresInDays = this.normalizeExpiresInDays(payload.expiresInDays);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const email = payload.email?.trim().toLowerCase();
    const token = this.generateInviteToken();

    if (!payload.teamId && !requestedTeamName) {
      throw new BadRequestException('teamId or teamName is required');
    }

    const joinBase = (process.env.TEAM_JOIN_BASE_URL ?? 'http://localhost:8080/register').replace(
      /\/+$/,
      '',
    );
    const inviteUrl = `${joinBase}?inviteToken=${token}`;

    if (this.usePostgres) {
      const team = await withTransaction(async (client: PoolClient) => {
        let teamId = payload.teamId;
        let teamName = requestedTeamName ?? '';

        if (teamId) {
          const teamResult = await client.query<{ id: string; name: string }>(
            `SELECT id, name
             FROM teams
             WHERE id = $1 AND tenant_id = $2
             LIMIT 1`,
            [teamId, currentUser.tenantId],
          );

          if (!teamResult.rows[0]) {
            throw new NotFoundException('team not found in this tenant');
          }

          teamName = teamResult.rows[0].name;
        } else {
          const createdTeam = await client.query<{ id: string; name: string }>(
            `INSERT INTO teams (tenant_id, name, description, created_by)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name`,
            [currentUser.tenantId, requestedTeamName, payload.description ?? null, currentUser.id],
          );
          teamId = createdTeam.rows[0].id;
          teamName = createdTeam.rows[0].name;
        }

        await client.query(
          `INSERT INTO invitations (tenant_id, invited_by, email, role, team_id, token, expires_at)
           VALUES ($1, $2, $3, $4::member_role, $5, $6, $7)`,
          [currentUser.tenantId, currentUser.id, email ?? `pending+${token.slice(0, 8)}@invite.local`, role, teamId, token, expiresAt.toISOString()],
        );

        return { id: teamId, name: teamName };
      });

      const response = {
        token,
        inviteUrl,
        teamId: team.id,
        teamName: team.name,
        role,
        email: email ?? null,
        expiresAt: expiresAt.toISOString(),
      };

      await this.sendTeamInviteEmailIfConfigured({
        email,
        inviteUrl,
        teamName: team.name,
        role,
        expiresAt: expiresAt.toISOString(),
      });

      return response;
    }

    let teamId = payload.teamId;
    let teamName = requestedTeamName ?? '';

    if (teamId) {
      const existingTeam = this.memoryTeams.get(teamId);
      if (!existingTeam || existingTeam.tenantId !== currentUser.tenantId) {
        throw new NotFoundException('team not found in this tenant');
      }
      teamName = existingTeam.name;
    } else {
      teamId = randomUUID();
      this.memoryTeams.set(teamId, {
        id: teamId,
        tenantId: currentUser.tenantId,
        name: requestedTeamName!,
        description: payload.description,
        createdBy: currentUser.id,
      });
      teamName = requestedTeamName!;
    }

    this.teamInvites.set(token, {
      token,
      tenantId: currentUser.tenantId,
      invitedBy: currentUser.id,
      teamId,
      teamName,
      email,
      role,
      expiresAt: expiresAt.toISOString(),
      status: 'pending',
    });

    const response = {
      token,
      inviteUrl,
      teamId,
      teamName,
      role,
      email: email ?? null,
      expiresAt: expiresAt.toISOString(),
    };

    await this.sendTeamInviteEmailIfConfigured({
      email,
      inviteUrl,
      teamName,
      role,
      expiresAt: expiresAt.toISOString(),
    });

    return response;
  }

  async joinTeamByInviteToken(token: string, payload: JoinTeamByInvitePayload) {
    if (!token?.trim()) {
      throw new BadRequestException('invite token is required');
    }

    if (this.usePostgres) {
      return this.joinTeamByInviteTokenPostgres(token.trim(), payload);
    }

    const invite = this.teamInvites.get(token.trim());
    if (!invite || invite.status !== 'pending') {
      throw new NotFoundException('invite not found or already used');
    }

    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      invite.status = 'expired';
      throw new BadRequestException('invite expired');
    }

    const payloadEmail = payload.email?.trim().toLowerCase();
    const inviteEmail = invite.email?.trim().toLowerCase();

    if (inviteEmail && payloadEmail && inviteEmail !== payloadEmail) {
      throw new BadRequestException('email does not match invite');
    }

    const email = payloadEmail ?? inviteEmail;
    if (!email) {
      throw new BadRequestException('email is required');
    }

    let user = [...this.users.values()].find(existing => existing.email === email);

    if (!user) {
      if (!payload.fullName?.trim()) {
        throw new BadRequestException('fullName is required for new user');
      }
      if (!payload.password) {
        throw new BadRequestException('password is required for new user');
      }

      user = {
        id: randomUUID(),
        tenantId: invite.tenantId,
        email,
        fullName: payload.fullName.trim(),
        passwordHash: await hash(payload.password, 12),
        twoFactorEnabled: false,
        createdAt: new Date().toISOString(),
      };
      this.users.set(user.id, user);
    } else if (user.tenantId !== invite.tenantId) {
      throw new BadRequestException('user belongs to another tenant');
    }

    invite.status = 'accepted';
    invite.acceptedAt = new Date().toISOString();

    return {
      joined: true,
      teamId: invite.teamId,
      teamName: invite.teamName,
      userId: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: invite.role,
    };
  }

  async getUserFromAccessToken(accessToken: string): Promise<SafeAuthUser> {
    const payload = this.verifyAccessToken(accessToken);
    const user = this.usePostgres ? await this.findUserById(payload.sub) : this.requireUser(payload.sub);
    return this.sanitizeUser(user);
  }

  async enableTwoFactor(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = this.usePostgres ? await this.findUserById(userId) : this.requireUser(userId);
    const secret = generateTotpSecret();

    if (this.usePostgres) {
      await query(
        `UPDATE users
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('pendingTwoFactorSecret', $2)
         WHERE id = $1`,
        [userId, secret],
      );
    } else {
      user.pendingTwoFactorSecret = secret;
    }

    return {
      secret,
      otpauthUrl: buildOtpAuthUrl(user.email, secret),
    };
  }

  async verifyTwoFactor(
    userId: string,
    code: string,
  ): Promise<{ verified: boolean; twoFactorEnabled: boolean }> {
    if (!code) {
      throw new BadRequestException('2fa code is required');
    }

    const user = this.usePostgres ? await this.findUserById(userId) : this.requireUser(userId);
    const secretToVerify = user.pendingTwoFactorSecret ?? user.twoFactorSecret;

    if (!secretToVerify || !verifyTotpCode(secretToVerify, code)) {
      throw new UnauthorizedException('invalid two-factor code');
    }

    if (this.usePostgres) {
      await query(
        `UPDATE users
         SET two_factor_enabled = TRUE,
             two_factor_secret = $2,
             metadata = COALESCE(metadata, '{}'::jsonb) - 'pendingTwoFactorSecret'
         WHERE id = $1`,
        [userId, secretToVerify],
      );
    } else {
      user.twoFactorEnabled = true;
      user.twoFactorSecret = secretToVerify;
      user.pendingTwoFactorSecret = undefined;
    }

    return {
      verified: true,
      twoFactorEnabled: true,
    };
  }

  health(): Record<string, unknown> {
    return {
      service: 'auth-service',
      status: 'ok',
      users: this.users.size,
      sessions: this.sessions.size,
      persistence: this.usePostgres ? 'postgres' : 'memory',
    };
  }

  private async registerWithPostgres(payload: RegisterPayload): Promise<SafeAuthUser> {
    const email = payload.email.trim().toLowerCase();
    const existing = await query<{ id: string }>('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);

    if (existing.rows[0]) {
      throw new ConflictException('email already registered');
    }

    const passwordHash = await hash(payload.password, 12);
    const tenantName = payload.tenantName?.trim() || `${payload.fullName.trim()} Workspace`;
    const tenantSlug = `${this.slugify(tenantName)}-${randomUUID().slice(0, 8)}`;

    const user = await withTransaction(async (client: PoolClient) => {
      const tenantResult = await client.query<{ id: string }>(
        `INSERT INTO tenants (name, slug, industry_vertical, plan, timezone, locale)
         VALUES ($1, $2, 'other', 'starter', 'Africa/Luanda', 'pt-AO')
         RETURNING id`,
        [tenantName, tenantSlug],
      );

      const userResult = await client.query<DatabaseUserRow>(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, two_factor_enabled, metadata)
         VALUES ($1, $2, $3, $4, FALSE, '{}'::jsonb)
         RETURNING id, tenant_id, email, full_name, password_hash, two_factor_enabled, two_factor_secret, metadata, created_at`,
        [tenantResult.rows[0].id, email, passwordHash, payload.fullName.trim()],
      );

      return this.mapDatabaseUser(userResult.rows[0]);
    });

    return this.sanitizeUser(user);
  }

  private async issueTokens(userId: string): Promise<AuthTokens> {
    const accessToken = this.signAccessToken(userId, this.accessTtl);
    const refreshToken = this.signRefreshToken(userId, this.refreshTtl);

    if (this.usePostgres) {
      await query(
        `INSERT INTO user_sessions (user_id, refresh_token, expires_at)
         VALUES ($1, $2, to_timestamp($3))`,
        [userId, refreshToken, Math.floor((Date.now() + this.refreshTtl * 1000) / 1000)],
      );
    } else {
      this.sessions.set(refreshToken, {
        id: randomUUID(),
        userId,
        refreshToken,
        expiresAt: Date.now() + this.refreshTtl * 1000,
      });
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTtl,
      refreshExpiresIn: this.refreshTtl,
    };
  }

  private signAccessToken(userId: string, ttlSeconds: number): string {
    const payload = {
      sub: userId,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      typ: 'access',
    };

    return this.signStructuredToken(payload, this.accessSecret);
  }

  private signRefreshToken(userId: string, ttlSeconds: number): string {
    const payload = {
      sub: userId,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      typ: 'refresh',
      jti: randomUUID(),
    };

    return this.signStructuredToken(payload, this.refreshSecret);
  }

  private signStructuredToken(payload: Record<string, unknown>, secret: string): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
    return `${encodedPayload}.${signature}`;
  }

  private verifyAccessToken(token: string): { sub: string; exp: number } {
    const [encodedPayload, signature] = token.split('.');

    if (!encodedPayload || !signature) {
      throw new UnauthorizedException('invalid access token');
    }

    const expectedSignature = createHmac('sha256', this.accessSecret)
      .update(encodedPayload)
      .digest('base64url');

    if (signature !== expectedSignature) {
      throw new UnauthorizedException('invalid access token');
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      sub: string;
      exp: number;
      typ: string;
    };

    if (payload.typ !== 'access' || payload.exp * 1000 < Date.now()) {
      throw new UnauthorizedException('access token expired or invalid');
    }

    return payload;
  }

  private sanitizeUser(user: AuthUser): SafeAuthUser {
    const { passwordHash, twoFactorSecret, pendingTwoFactorSecret, ...safeUser } = user;
    void passwordHash;
    void twoFactorSecret;
    void pendingTwoFactorSecret;
    return safeUser;
  }

  private requireUser(userId: string): AuthUser {
    const user = this.users.get(userId);

    if (!user) {
      throw new UnauthorizedException('user not found');
    }

    return user;
  }

  private async findUserById(userId: string): Promise<AuthUser> {
    const result = await query<DatabaseUserRow>(
      `SELECT id, tenant_id, email, full_name, password_hash, two_factor_enabled, two_factor_secret, metadata, created_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId],
    );

    if (!result.rows[0]) {
      throw new UnauthorizedException('user not found');
    }

    return this.mapDatabaseUser(result.rows[0]);
  }

  private async findUserByEmail(email: string): Promise<AuthUser | undefined> {
    const result = await query<DatabaseUserRow>(
      `SELECT id, tenant_id, email, full_name, password_hash, two_factor_enabled, two_factor_secret, metadata, created_at
       FROM users
       WHERE email = $1
       ORDER BY created_at ASC
       LIMIT 1`,
      [email.trim().toLowerCase()],
    );

    if (!result.rows[0]) {
      return undefined;
    }

    return this.mapDatabaseUser(result.rows[0]);
  }

  private mapDatabaseUser(row: DatabaseUserRow): AuthUser {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      fullName: row.full_name,
      passwordHash: row.password_hash,
      twoFactorEnabled: row.two_factor_enabled,
      twoFactorSecret: row.two_factor_secret ?? undefined,
      pendingTwoFactorSecret:
        typeof row.metadata?.pendingTwoFactorSecret === 'string'
          ? (row.metadata.pendingTwoFactorSecret as string)
          : undefined,
      createdAt: row.created_at,
    };
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private normalizeInviteRole(role?: string): InviteRole {
    const normalized = role?.trim().toLowerCase();
    const allowed: InviteRole[] = ['admin', 'manager', 'member', 'viewer', 'guest'];
    if (!normalized) return 'member';
    if (allowed.includes(normalized as InviteRole)) {
      return normalized as InviteRole;
    }
    throw new BadRequestException('invalid invite role');
  }

  private normalizeExpiresInDays(input?: number): number {
    if (!input) return 7;
    if (!Number.isFinite(input)) {
      throw new BadRequestException('expiresInDays must be a finite number');
    }
    const value = Math.floor(input);
    if (value < 1 || value > 30) {
      throw new BadRequestException('expiresInDays must be between 1 and 30');
    }
    return value;
  }

  private generateInviteToken(): string {
    return `${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
  }

  private async sendTeamInviteEmailIfConfigured(input: {
    email?: string;
    inviteUrl: string;
    teamName: string;
    role: InviteRole;
    expiresAt: string;
  }): Promise<void> {
    if (!input.email) return;

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    if (!resendApiKey || !fromEmail) {
      this.logger.warn('Skipping invite email: RESEND_API_KEY or RESEND_FROM_EMAIL is not configured');
      return;
    }

    const subject = `Convite para entrar na equipa ${input.teamName}`;
    const text = [
      `Olá,`,
      ``,
      `Você foi convidado para a equipa "${input.teamName}" com o papel "${input.role}".`,
      `Use este link para entrar: ${input.inviteUrl}`,
      `Expira em: ${new Date(input.expiresAt).toLocaleString('pt-PT')}`,
      ``,
      `Ngola Projects`,
    ].join('\n');

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
        <h2 style="margin:0 0 12px">Convite de equipa</h2>
        <p>Você foi convidado para a equipa <strong>${this.escapeHtml(input.teamName)}</strong> com o papel <strong>${this.escapeHtml(input.role)}</strong>.</p>
        <p><a href="${input.inviteUrl}" style="display:inline-block;padding:10px 14px;background:#185FA5;color:#fff;text-decoration:none;border-radius:8px">Entrar na equipa</a></p>
        <p>Ou copie e cole este link no browser:</p>
        <p><code>${this.escapeHtml(input.inviteUrl)}</code></p>
        <p style="color:#475569;font-size:12px">Expira em: ${this.escapeHtml(
          new Date(input.expiresAt).toLocaleString('pt-PT'),
        )}</p>
      </div>
    `;

    try {
      await axios.post(
        'https://api.resend.com/emails',
        {
          from: fromEmail,
          to: [input.email],
          subject,
          html,
          text,
        },
        {
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Failed to send team invite email via Resend: ${message}`);
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private async joinTeamByInviteTokenPostgres(token: string, payload: JoinTeamByInvitePayload) {
    return withTransaction(async (client: PoolClient) => {
      const inviteResult = await client.query<{
        id: string;
        tenant_id: string;
        team_id: string | null;
        email: string;
        role: InviteRole;
        status: 'pending' | 'accepted' | 'expired' | 'revoked';
        expires_at: string;
      }>(
        `SELECT id, tenant_id, team_id, email, role, status, expires_at
         FROM invitations
         WHERE token = $1
         LIMIT 1`,
        [token],
      );

      const invite = inviteResult.rows[0];
      if (!invite) {
        throw new NotFoundException('invite not found');
      }

      if (invite.status !== 'pending') {
        throw new BadRequestException('invite already used or invalid');
      }

      if (!invite.team_id) {
        throw new BadRequestException('invite has no linked team');
      }

      if (new Date(invite.expires_at).getTime() < Date.now()) {
        await client.query(`UPDATE invitations SET status = 'expired' WHERE id = $1`, [invite.id]);
        throw new BadRequestException('invite expired');
      }

      const teamResult = await client.query<{ id: string; name: string }>(
        `SELECT id, name
         FROM teams
         WHERE id = $1
         LIMIT 1`,
        [invite.team_id],
      );

      if (!teamResult.rows[0]) {
        throw new NotFoundException('team linked to invite was not found');
      }

      const payloadEmail = payload.email?.trim().toLowerCase();
      const inviteEmail = invite.email?.trim().toLowerCase();
      const inviteIsOpen = inviteEmail.endsWith('@invite.local');

      if (!inviteIsOpen && payloadEmail && inviteEmail !== payloadEmail) {
        throw new BadRequestException('email does not match invite');
      }

      const targetEmail = inviteIsOpen ? payloadEmail : payloadEmail ?? inviteEmail;
      if (!targetEmail) {
        throw new BadRequestException('email is required');
      }

      let userId: string;

      const existingUser = await client.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id
         FROM users
         WHERE email = $1
         ORDER BY created_at ASC
         LIMIT 1`,
        [targetEmail],
      );

      if (existingUser.rows[0]) {
        if (existingUser.rows[0].tenant_id !== invite.tenant_id) {
          throw new BadRequestException('user belongs to another tenant');
        }
        userId = existingUser.rows[0].id;
      } else {
        if (!payload.fullName?.trim()) {
          throw new BadRequestException('fullName is required for new user');
        }
        if (!payload.password) {
          throw new BadRequestException('password is required for new user');
        }
        const passwordHash = await hash(payload.password, 12);
        const insertedUser = await client.query<{ id: string }>(
          `INSERT INTO users (tenant_id, email, password_hash, full_name, two_factor_enabled, metadata)
           VALUES ($1, $2, $3, $4, FALSE, '{}'::jsonb)
           RETURNING id`,
          [invite.tenant_id, targetEmail, passwordHash, payload.fullName.trim()],
        );
        userId = insertedUser.rows[0].id;
      }

      await client.query(
        `INSERT INTO team_members (team_id, user_id, role)
         VALUES ($1, $2, $3::member_role)
         ON CONFLICT (team_id, user_id) DO UPDATE
         SET role = EXCLUDED.role`,
        [invite.team_id, userId, invite.role],
      );

      await client.query(
        `UPDATE invitations
         SET status = 'accepted',
             accepted_at = NOW()
         WHERE id = $1`,
        [invite.id],
      );

      return {
        joined: true,
        teamId: invite.team_id,
        teamName: teamResult.rows[0].name,
        userId,
        email: targetEmail,
        tenantId: invite.tenant_id,
        role: invite.role,
      };
    });
  }
}
