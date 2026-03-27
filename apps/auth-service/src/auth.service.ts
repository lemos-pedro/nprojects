import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { PoolClient } from 'pg';
import { createHmac, randomUUID } from 'crypto';

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

@Injectable()
export class AuthService {
  private readonly usePostgres = isPostgresEnabled();
  private readonly users = new Map<string, AuthUser>();
  private readonly sessions = new Map<string, AuthSession>();
  private readonly accessSecret = process.env.AUTH_JWT_ACCESS_SECRET ?? 'dev-access-secret';
  private readonly refreshSecret = process.env.AUTH_JWT_REFRESH_SECRET ?? 'dev-refresh-secret';
  private readonly accessTtl = Number(process.env.AUTH_ACCESS_TOKEN_TTL ?? 900);
  private readonly refreshTtl = Number(process.env.AUTH_REFRESH_TOKEN_TTL ?? 604800);

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
}
