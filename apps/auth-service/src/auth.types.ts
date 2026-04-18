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
  teams?: TeamMembership[];
}

export interface TeamMembership {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'manager' | 'member' | 'viewer' | 'guest';
  joinedAt?: string;
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

export interface TeamSummary {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  role: 'owner' | 'admin' | 'manager' | 'member' | 'viewer' | 'guest';
  memberCount: number;
}

export interface TeamMemberSummary {
  userId: string;
  email: string;
  fullName: string;
  role: 'owner' | 'admin' | 'manager' | 'member' | 'viewer' | 'guest';
  joinedAt?: string;
}
