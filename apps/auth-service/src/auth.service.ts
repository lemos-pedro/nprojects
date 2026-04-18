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
  TeamMemberSummary,
  TeamMembership,
  TeamSummary,
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

interface MemoryTeam {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: string;
}

interface MemoryTeamMember {
  teamId: string;
  userId: string;
  role: InviteRole | 'owner';
  joinedAt: string;
}

interface DatabaseTeamMembershipRow {
  team_id: string;
  team_name: string;
  user_id: string;
  role: InviteRole | 'owner';
  joined_at: string | null;
}

interface DatabaseTeamRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  role: InviteRole | 'owner';
  member_count: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly usePostgres = isPostgresEnabled();
  private readonly accessSecret = process.env.AUTH_JWT_ACCESS_SECRET ?? 'dev-access-secret';
  private readonly refreshSecret = process.env.AUTH_JWT_REFRESH_SECRET ?? 'dev-refresh-secret';
  private readonly accessTtl = Number(process.env.AUTH_ACCESS_TOKEN_TTL ?? 900);
  private readonly refreshTtl = Number(process.env.AUTH_REFRESH_TOKEN_TTL ?? 604800);
  private readonly inviteCodeLength = this.resolveInviteCodeLength();
  private readonly users = new Map<string, AuthUser>();
  private readonly usersByEmail = new Map<string, string>();
  private readonly sessions = new Map<string, AuthSession>();
  private readonly teamInvites = new Map<string, MemoryTeamInvite>();
  private readonly teams = new Map<string, MemoryTeam>();
  private readonly teamMembers = new Map<string, MemoryTeamMember[]>();

  async register(payload: RegisterPayload): Promise<{ user: SafeAuthUser; tokens: AuthTokens }> {
    if (!payload.email || !payload.password || !payload.fullName) {
      throw new BadRequestException('email, password and fullName are required');
    }

    return this.usePostgres ? this.registerWithPostgres(payload) : this.registerInMemory(payload);
  }

  async login(payload: LoginPayload): Promise<{ user: SafeAuthUser; tokens: AuthTokens }> {
    if (!payload.email || !payload.password) {
      throw new BadRequestException('email and password are required');
    }

    const user = await this.findUserByEmail(payload.email);

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

    if (!this.usePostgres) {
      const session = this.sessions.get(refreshToken);

      if (!session || session.expiresAt < Date.now()) {
        throw new UnauthorizedException('refresh token expired or invalid');
      }

      this.sessions.delete(refreshToken);
      return this.issueTokens(session.userId);
    }

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

  async logout(refreshToken: string): Promise<{ revoked: boolean }> {
    if (!refreshToken) {
      throw new BadRequestException('refresh token is required');
    }

    if (!this.usePostgres) {
      const revoked = this.sessions.delete(refreshToken);
      return { revoked };
    }

    const result = await query('DELETE FROM user_sessions WHERE refresh_token = $1', [refreshToken]);
    return { revoked: Boolean(result.rowCount) };
  }

  async getProfile(userId: string): Promise<SafeAuthUser> {
    const user = await this.findUserById(userId);
    return this.sanitizeUser(user);
  }

  async getUsersByTenant(tenantId: string, teamId?: string): Promise<SafeAuthUser[]> {
    if (!this.usePostgres) {
      return this.buildUsersWithTeamMembership(
        Array.from(this.users.values()).filter(user =>
          teamId ? this.isUserInMemoryTeam(user.id, teamId) : user.tenantId === tenantId,
        ),
        tenantId,
        teamId,
      );
    }

    const result = teamId
      ? await query<DatabaseUserRow>(
          `SELECT DISTINCT u.id, u.tenant_id, u.email, u.full_name, u.password_hash,
                  u.two_factor_enabled, u.two_factor_secret, u.metadata, u.created_at
           FROM users u
           INNER JOIN (
             SELECT tm.user_id
             FROM team_members tm
             INNER JOIN teams t ON t.id = tm.team_id
             WHERE t.tenant_id = $1 AND tm.team_id = $2
             UNION
             SELECT t.created_by
             FROM teams t
             WHERE t.tenant_id = $1 AND t.id = $2
           ) visible_users ON visible_users.user_id = u.id
           ORDER BY u.created_at ASC`,
          [tenantId, teamId],
        )
      : await query<DatabaseUserRow>(
          `SELECT DISTINCT u.id, u.tenant_id, u.email, u.full_name, u.password_hash,
                  u.two_factor_enabled, u.two_factor_secret, u.metadata, u.created_at
           FROM users u
           WHERE u.tenant_id = $1
           UNION
           SELECT DISTINCT u.id, u.tenant_id, u.email, u.full_name, u.password_hash,
                  u.two_factor_enabled, u.two_factor_secret, u.metadata, u.created_at
           FROM users u
           INNER JOIN team_members tm ON tm.user_id = u.id
           INNER JOIN teams t ON t.id = tm.team_id
           WHERE t.tenant_id = $1
           ORDER BY created_at ASC`,
          [tenantId],
        );

    return this.buildUsersWithTeamMembership(
      result.rows.map(row => this.mapDatabaseUser(row)),
      tenantId,
      teamId,
    );
  }

  async listTeamsForUser(currentUser: SafeAuthUser): Promise<TeamSummary[]> {
    if (!this.usePostgres) {
      return Array.from(this.teams.values())
        .filter(
          team =>
            team.tenantId === currentUser.tenantId &&
            (team.createdBy === currentUser.id || this.isUserInMemoryTeam(currentUser.id, team.id)),
        )
        .map(team => ({
          id: team.id,
          tenantId: team.tenantId,
          name: team.name,
          description: team.description,
          createdBy: team.createdBy,
          createdAt: team.createdAt,
          role: team.createdBy === currentUser.id ? 'owner' : this.getMemoryTeamRole(team.id, currentUser.id) ?? 'member',
          memberCount: this.getMemoryTeamMemberCount(team.id),
        }));
    }

    const result = await query<DatabaseTeamRow>(
      `SELECT t.id, t.tenant_id, t.name, t.description, t.created_by, t.created_at,
              COALESCE(tm.role::text, CASE WHEN t.created_by = $1 THEN 'owner' END) AS role,
              (
                SELECT COUNT(*)::int
                FROM (
                  SELECT tm2.user_id
                  FROM team_members tm2
                  WHERE tm2.team_id = t.id
                  UNION
                  SELECT t.created_by
                ) team_users
              ) AS member_count
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $1
       WHERE t.tenant_id = $2
         AND (tm.user_id IS NOT NULL OR t.created_by = $1)
       ORDER BY t.created_at ASC`,
      [currentUser.id, currentUser.tenantId],
    );

    return result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description ?? undefined,
      createdBy: row.created_by,
      createdAt: row.created_at,
      role: row.role,
      memberCount: row.member_count,
    }));
  }

  async getTeamMembers(
    currentUser: SafeAuthUser,
    teamId: string,
  ): Promise<{ teamId: string; members: TeamMemberSummary[] }> {
    if (!this.usePostgres) {
      const team = this.teams.get(teamId);
      if (!team || team.tenantId !== currentUser.tenantId) {
        throw new NotFoundException('team not found');
      }

      return {
        teamId,
        members: this.listMemoryTeamMembers(teamId),
      };
    }

    const teamResult = await query<{ id: string }>(
      `SELECT id
       FROM teams
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1`,
      [teamId, currentUser.tenantId],
    );

    if (!teamResult.rows[0]) {
      throw new NotFoundException('team not found');
    }

    const result = await query<{
      user_id: string;
      email: string;
      full_name: string;
      role: InviteRole | 'owner';
      joined_at: string | null;
    }>(
      `SELECT DISTINCT ON (team_users.user_id)
              team_users.user_id,
              team_users.email,
              team_users.full_name,
              team_users.role,
              team_users.joined_at
       FROM (
         SELECT u.id AS user_id,
                u.email,
                u.full_name,
                'owner'::text AS role,
                t.created_at AS joined_at,
                1 AS precedence
         FROM teams t
         INNER JOIN users u ON u.id = t.created_by
         WHERE t.id = $1
         UNION ALL
         SELECT u.id AS user_id,
                u.email,
                u.full_name,
                tm.role::text AS role,
                tm.joined_at,
                0 AS precedence
         FROM team_members tm
         INNER JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = $1
       ) team_users
       ORDER BY team_users.user_id, team_users.precedence DESC, team_users.joined_at ASC`,
      [teamId],
    );

    return {
      teamId,
      members: result.rows.map(row => ({
        userId: row.user_id,
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        joinedAt: row.joined_at ?? undefined,
      })),
    };
  }

  async createTeamInviteLink(currentUser: SafeAuthUser, payload: TeamInvitePayload) {
    if (!this.usePostgres) {
      return this.createTeamInviteLinkInMemory(currentUser, payload);
    }

    const role = this.normalizeInviteRole(payload.role);
    const requestedTeamName = payload.teamName?.trim();
    const expiresInDays = this.normalizeExpiresInDays(payload.expiresInDays);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const email = payload.email?.trim().toLowerCase();

    if (!payload.teamId && !requestedTeamName) {
      throw new BadRequestException('teamId or teamName is required');
    }

    const team = await withTransaction(async (client: PoolClient) => {
      const token = await this.generateInviteTokenWithClient(client);
      let teamId = payload.teamId;
      let teamName = requestedTeamName ?? '';

      if (teamId) {
        const teamResult = await client.query<{ id: string; name: string; created_by: string }>(
          `SELECT id, name, created_by
           FROM teams
           WHERE id = $1 AND tenant_id = $2
           LIMIT 1`,
          [teamId, currentUser.tenantId],
        );

        if (!teamResult.rows[0]) {
          throw new NotFoundException('team not found in this tenant');
        }

        if (teamResult.rows[0].created_by !== currentUser.id) {
          const membership = await client.query<{ role: InviteRole }>(
            `SELECT role
             FROM team_members
             WHERE team_id = $1 AND user_id = $2
             LIMIT 1`,
            [teamId, currentUser.id],
          );

          if (!membership.rows[0]) {
            throw new UnauthorizedException('only team members can create invites for this team');
          }
        }

        teamName = teamResult.rows[0].name;
      } else {
        const createdTeam = await client.query<{ id: string; name: string; created_at: string }>(
          `INSERT INTO teams (tenant_id, name, description, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, created_at`,
          [currentUser.tenantId, requestedTeamName, payload.description ?? null, currentUser.id],
        );
        teamId = createdTeam.rows[0].id;
        teamName = createdTeam.rows[0].name;

        await client.query(
          `INSERT INTO team_members (team_id, user_id, role, joined_at)
           VALUES ($1, $2, 'owner'::member_role, $3)
           ON CONFLICT (team_id, user_id) DO NOTHING`,
          [teamId, currentUser.id, createdTeam.rows[0].created_at],
        );
      }

      await client.query(
        `INSERT INTO invitations (tenant_id, invited_by, email, role, team_id, token, expires_at)
         VALUES ($1, $2, $3, $4::member_role, $5, $6, $7)`,
        [
          currentUser.tenantId,
          currentUser.id,
          email ?? `pending+${token}@invite.local`,
          role,
          teamId,
          token,
          expiresAt.toISOString(),
        ],
      );

      return { id: teamId, name: teamName, token };
    });

    const joinBase = (process.env.TEAM_JOIN_BASE_URL ?? 'http://localhost:8080/register').replace(
      /\/+$/,
      '',
    );
    const inviteUrl = `${joinBase}?inviteToken=${team.token}`;

    const response = {
      token: team.token,
      inviteCode: team.token,
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
      inviteCode: team.token,
      expiresAt: expiresAt.toISOString(),
    });

    return response;
  }

  async joinTeamByInviteToken(token: string, payload: JoinTeamByInvitePayload) {
    if (!token?.trim()) {
      throw new BadRequestException('invite token is required');
    }

    return this.usePostgres
      ? this.joinTeamByInviteTokenPostgres(token.trim(), payload)
      : this.joinTeamByInviteTokenInMemory(token.trim(), payload);
  }

  async getUserFromAccessToken(accessToken: string): Promise<SafeAuthUser> {
    const payload = this.verifyAccessToken(accessToken);
    const user = await this.findUserById(payload.sub);
    return this.sanitizeUser(user);
  }

  async enableTwoFactor(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.findUserById(userId);
    const secret = generateTotpSecret();

    if (!this.usePostgres) {
      user.pendingTwoFactorSecret = secret;
      this.saveMemoryUser(user);
      return {
        secret,
        otpauthUrl: buildOtpAuthUrl(user.email, secret),
      };
    }

    await query(
      `UPDATE users
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('pendingTwoFactorSecret', $2)
       WHERE id = $1`,
      [userId, secret],
    );

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

    const user = await this.findUserById(userId);
    const secretToVerify = user.pendingTwoFactorSecret ?? user.twoFactorSecret;

    if (!secretToVerify || !verifyTotpCode(secretToVerify, code)) {
      throw new UnauthorizedException('invalid two-factor code');
    }

    if (!this.usePostgres) {
      user.twoFactorEnabled = true;
      user.twoFactorSecret = secretToVerify;
      delete user.pendingTwoFactorSecret;
      this.saveMemoryUser(user);
      return {
        verified: true,
        twoFactorEnabled: true,
      };
    }

    await query(
      `UPDATE users
       SET two_factor_enabled = TRUE,
           two_factor_secret = $2,
           metadata = COALESCE(metadata, '{}'::jsonb) - 'pendingTwoFactorSecret'
       WHERE id = $1`,
      [userId, secretToVerify],
    );

    return {
      verified: true,
      twoFactorEnabled: true,
    };
  }

  async loginWithGoogle(
    googleEmail: string,
    googleName: string,
  ): Promise<{ user: SafeAuthUser; tokens: AuthTokens }> {
    const email = googleEmail.trim().toLowerCase();

    if (!this.usePostgres) {
      let user = await this.findUserByEmail(email);

      if (!user) {
        user = {
          id: randomUUID(),
          tenantId: randomUUID(),
          email,
          fullName: googleName.trim(),
          passwordHash: '',
          twoFactorEnabled: false,
          createdAt: new Date().toISOString(),
        };
        this.saveMemoryUser(user);
      }

      const tokens = await this.issueTokens(user.id);
      return { user: this.sanitizeUser(user), tokens };
    }

    let user = await this.findUserByEmail(email);

    if (!user) {
      const tenantName = `${googleName.trim()} Workspace`;
      const tenantSlug = `${this.slugify(tenantName)}-${randomUUID().slice(0, 8)}`;

      const createdUser = await withTransaction(async (client: PoolClient) => {
        const tenantResult = await client.query<{ id: string }>(
          `INSERT INTO tenants (name, slug, industry_vertical, plan, timezone, locale)
           VALUES ($1, $2, 'other', 'starter', 'Africa/Luanda', 'pt-AO')
           RETURNING id`,
          [tenantName, tenantSlug],
        );

        const userResult = await client.query<DatabaseUserRow>(
          `INSERT INTO users (tenant_id, email, password_hash, full_name, two_factor_enabled, metadata)
           VALUES ($1, $2, '', $3, FALSE, '{"provider": "google"}'::jsonb)
           RETURNING id, tenant_id, email, full_name, password_hash, two_factor_enabled, two_factor_secret, metadata, created_at`,
          [tenantResult.rows[0].id, email, googleName.trim()],
        );

        return this.mapDatabaseUser(userResult.rows[0]);
      });

      user = createdUser;
    }

    const tokens = await this.issueTokens(user.id);
    return { user: this.sanitizeUser(user), tokens };
  }

  health(): Record<string, unknown> {
    return {
      service: 'auth-service',
      status: 'ok',
      persistence: this.usePostgres ? 'postgres' : 'memory',
    };
  }

  private async registerWithPostgres(payload: RegisterPayload): Promise<{ user: SafeAuthUser; tokens: AuthTokens }> {
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

    const tokens = await this.issueTokens(user.id);
    return { user: this.sanitizeUser(user), tokens };
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



  private async findUserById(userId: string): Promise<AuthUser> {
    if (!this.usePostgres) {
      const user = this.users.get(userId);
      if (!user) {
        throw new UnauthorizedException('user not found');
      }
      return user;
    }

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
    if (!this.usePostgres) {
      const userId = this.usersByEmail.get(email.trim().toLowerCase());
      return userId ? this.users.get(userId) : undefined;
    }

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

  private async registerInMemory(
    payload: RegisterPayload,
  ): Promise<{ user: SafeAuthUser; tokens: AuthTokens }> {
    const email = payload.email.trim().toLowerCase();
    if (this.usersByEmail.has(email)) {
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

    this.saveMemoryUser(user);

    const tokens = await this.issueTokens(user.id);
    return { user: this.sanitizeUser(user), tokens };
  }

  private createTeamInviteLinkInMemory(currentUser: SafeAuthUser, payload: TeamInvitePayload) {
    const role = this.normalizeInviteRole(payload.role);
    const expiresInDays = this.normalizeExpiresInDays(payload.expiresInDays);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const token = this.generateInviteToken();
    const email = payload.email?.trim().toLowerCase();
    const teamId = payload.teamId ?? randomUUID();
    const existingTeam = payload.teamId ? this.teams.get(payload.teamId) : undefined;
    if (payload.teamId && !existingTeam) {
      throw new NotFoundException('team not found in this tenant');
    }

    const teamName = payload.teamName?.trim() || existingTeam?.name || `Team ${teamId.slice(0, 8)}`;
    const joinBase = (process.env.TEAM_JOIN_BASE_URL ?? 'http://localhost:8080/register').replace(
      /\/+$/,
      '',
    );
    const inviteUrl = `${joinBase}?inviteToken=${token}`;

    if (!payload.teamId) {
      this.teams.set(teamId, {
        id: teamId,
        tenantId: currentUser.tenantId,
        name: teamName,
        description: payload.description,
        createdBy: currentUser.id,
        createdAt: new Date().toISOString(),
      });
      this.upsertMemoryTeamMember(teamId, currentUser.id, 'owner');
    }

    this.teamInvites.set(token, {
      token,
      tenantId: currentUser.tenantId,
      invitedBy: currentUser.id,
      teamId,
      teamName,
      email,
      role,
      expiresAt,
      status: 'pending',
    });

    return {
      token,
      inviteCode: token,
      inviteUrl,
      teamId,
      teamName,
      role,
      email: email ?? null,
      expiresAt,
    };
  }

  private async joinTeamByInviteTokenInMemory(token: string, payload: JoinTeamByInvitePayload) {
    const invite = this.teamInvites.get(token);
    if (!invite || invite.status !== 'pending') {
      throw new NotFoundException('invite not found or no longer active');
    }

    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      invite.status = 'expired';
      throw new UnauthorizedException('invite expired');
    }

    const email = payload.email?.trim().toLowerCase() ?? invite.email;
    const fullName = payload.fullName?.trim();

    if (!email || !fullName) {
      throw new BadRequestException('email and fullName are required');
    }

    let user = await this.findUserByEmail(email);
    if (!user) {
      if (!payload.password) {
        throw new BadRequestException('password is required for new users');
      }

      user = {
        id: randomUUID(),
        tenantId: invite.tenantId,
        email,
        fullName,
        passwordHash: await hash(payload.password, 12),
        twoFactorEnabled: false,
        createdAt: new Date().toISOString(),
      };
    } else {
      user.tenantId = invite.tenantId;
      user.fullName = fullName;
    }

    this.saveMemoryUser(user);
    this.upsertMemoryTeamMember(invite.teamId, user.id, invite.role);
    invite.status = 'accepted';
    invite.acceptedAt = new Date().toISOString();

    const tokens = await this.issueTokens(user.id);
    return {
      accepted: true,
      teamId: invite.teamId,
      teamName: invite.teamName,
      role: invite.role,
      user: this.sanitizeUser(user),
      tokens,
    };
  }

  private saveMemoryUser(user: AuthUser): void {
    this.users.set(user.id, user);
    this.usersByEmail.set(user.email.trim().toLowerCase(), user.id);
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
    let token = '';
    do {
      token = this.generateNumericCode();
    } while (this.teamInvites.has(token));
    return token;
  }

  private async sendTeamInviteEmailIfConfigured(input: {
    email?: string;
    inviteUrl: string;
    teamName: string;
    role: InviteRole;
    inviteCode: string;
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
      `Código de convite: ${input.inviteCode}`,
      `Use este link para entrar: ${input.inviteUrl}`,
      `Expira em: ${new Date(input.expiresAt).toLocaleString('pt-PT')}`,
      ``,
      `Ngola Projects`,
    ].join('\n');

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
        <h2 style="margin:0 0 12px">Convite de equipa</h2>
        <p>Você foi convidado para a equipa <strong>${this.escapeHtml(input.teamName)}</strong> com o papel <strong>${this.escapeHtml(input.role)}</strong>.</p>
        <p><strong>Código do convite:</strong> <code>${this.escapeHtml(input.inviteCode)}</code></p>
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
        // User exists in any tenant — add to team directly via team_members
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

  private async generateInviteTokenWithClient(client: PoolClient): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const token = this.generateNumericCode();
      const existing = await client.query<{ token: string }>(
        `SELECT token
         FROM invitations
         WHERE token = $1
         LIMIT 1`,
        [token],
      );
      if (!existing.rows[0]) {
        return token;
      }
    }

    throw new Error('failed to generate a unique invite token');
  }

  private generateNumericCode(): string {
    let value = '';
    for (let i = 0; i < this.inviteCodeLength; i += 1) {
      value += Math.floor(Math.random() * 10).toString();
    }
    return value;
  }

  private resolveInviteCodeLength(): 6 | 8 {
    const raw = Number(process.env.TEAM_INVITE_CODE_LENGTH ?? 8);
    return raw === 6 ? 6 : 8;
  }

  private buildUsersWithTeamMembership(
    users: AuthUser[],
    tenantId: string,
    teamId?: string,
  ): SafeAuthUser[] {
    const membershipMap = this.usePostgres
      ? undefined
      : this.buildMemoryMembershipMap(tenantId, teamId);

    if (!this.usePostgres && membershipMap) {
      return users.map(user => this.attachMemberships(this.sanitizeUser(user), membershipMap.get(user.id) ?? []));
    }

    return users;
  }

  private attachMemberships(user: SafeAuthUser, teams: TeamMembership[]): SafeAuthUser {
    if (teams.length === 0) {
      return user;
    }

    return {
      ...user,
      teams,
    };
  }

  private buildMemoryMembershipMap(
    tenantId: string,
    teamId?: string,
  ): Map<string, TeamMembership[]> {
    const memberships = new Map<string, TeamMembership[]>();

    for (const team of this.teams.values()) {
      if (team.tenantId !== tenantId) {
        continue;
      }
      if (teamId && team.id !== teamId) {
        continue;
      }

      this.pushMembership(memberships, team.createdBy, {
        id: team.id,
        name: team.name,
        role: 'owner',
        joinedAt: team.createdAt,
      });

      for (const member of this.teamMembers.get(team.id) ?? []) {
        if (member.userId === team.createdBy && member.role === 'owner') {
          continue;
        }
        this.pushMembership(memberships, member.userId, {
          id: team.id,
          name: team.name,
          role: member.role,
          joinedAt: member.joinedAt,
        });
      }
    }

    return memberships;
  }

  private pushMembership(
    memberships: Map<string, TeamMembership[]>,
    userId: string,
    membership: TeamMembership,
  ): void {
    const existing = memberships.get(userId) ?? [];
    if (!existing.some(team => team.id === membership.id)) {
      existing.push(membership);
      memberships.set(userId, existing);
    }
  }

  private isUserInMemoryTeam(userId: string, teamId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    if (team.createdBy === userId) return true;
    return (this.teamMembers.get(teamId) ?? []).some(member => member.userId === userId);
  }

  private getMemoryTeamRole(teamId: string, userId: string): InviteRole | 'owner' | undefined {
    const team = this.teams.get(teamId);
    if (!team) return undefined;
    if (team.createdBy === userId) return 'owner';
    return (this.teamMembers.get(teamId) ?? []).find(member => member.userId === userId)?.role;
  }

  private getMemoryTeamMemberCount(teamId: string): number {
    const team = this.teams.get(teamId);
    if (!team) return 0;
    const uniqueUsers = new Set<string>([team.createdBy]);
    for (const member of this.teamMembers.get(teamId) ?? []) {
      uniqueUsers.add(member.userId);
    }
    return uniqueUsers.size;
  }

  private listMemoryTeamMembers(teamId: string): TeamMemberSummary[] {
    const team = this.teams.get(teamId);
    if (!team) {
      return [];
    }

    const membersByUserId = new Map<string, TeamMemberSummary>();
    const owner = this.users.get(team.createdBy);
    if (owner) {
      membersByUserId.set(owner.id, {
        userId: owner.id,
        email: owner.email,
        fullName: owner.fullName,
        role: 'owner',
        joinedAt: team.createdAt,
      });
    }

    for (const member of this.teamMembers.get(teamId) ?? []) {
      const user = this.users.get(member.userId);
      if (!user) continue;
      if (membersByUserId.has(user.id) && membersByUserId.get(user.id)?.role === 'owner') {
        continue;
      }
      membersByUserId.set(user.id, {
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        role: member.role,
        joinedAt: member.joinedAt,
      });
    }

    return Array.from(membersByUserId.values());
  }

  private upsertMemoryTeamMember(teamId: string, userId: string, role: InviteRole | 'owner'): void {
    const current = this.teamMembers.get(teamId) ?? [];
    const existingIndex = current.findIndex(member => member.userId === userId);
    const joinedAt = existingIndex >= 0 ? current[existingIndex].joinedAt : new Date().toISOString();

    const nextMember: MemoryTeamMember = {
      teamId,
      userId,
      role,
      joinedAt,
    };

    if (existingIndex >= 0) {
      current[existingIndex] = nextMember;
    } else {
      current.push(nextMember);
    }

    this.teamMembers.set(teamId, current);
  }
}
