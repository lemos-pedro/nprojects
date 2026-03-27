export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  passwordHash: string;
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  pendingTwoFactorSecret?: string;
  createdAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  refreshToken: string;
  expiresAt: number;
}

export interface RegisterPayload {
  email: string;
  password: string;
  fullName: string;
  tenantName?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
  twoFactorCode?: string;
}

export interface AccessSession {
  token: string;
  userId: string;
  expiresAt: number;
}
