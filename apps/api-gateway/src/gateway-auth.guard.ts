import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

import { extractBearerToken, verifyAccessToken } from '@ngola/shared';

type PublicRoute = {
  method: string;
  path: string;
  match: 'exact' | 'prefix';
};

@Injectable()
export class GatewayAuthGuard implements CanActivate {
  private readonly accessSecret = process.env.AUTH_JWT_ACCESS_SECRET ?? 'dev-access-secret';
  private readonly publicRoutes: PublicRoute[] = [
    { method: 'GET', path: '/api/v1/health', match: 'exact' },
    { method: 'GET', path: '/api/v1/auth/health', match: 'exact' },
    { method: 'POST', path: '/api/v1/auth/register', match: 'exact' },
    { method: 'POST', path: '/api/v1/auth/login', match: 'exact' },
    { method: 'POST', path: '/api/v1/auth/refresh', match: 'exact' },
    { method: 'POST', path: '/api/v1/auth/logout', match: 'exact' },
    { method: 'GET', path: '/api/v1/auth/google', match: 'exact' },
    { method: 'GET', path: '/api/v1/auth/google/callback', match: 'exact' },
    { method: 'POST', path: '/api/v1/team/join/', match: 'prefix' },
  ];

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();
    const path = (request.originalUrl || request.url || '').split('?')[0];

    if (method === 'OPTIONS' || this.isPublicRoute(method, path)) {
      return true;
    }

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('authorization token is required');
    }

    try {
      verifyAccessToken(token, this.accessSecret);
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : 'invalid access token');
    }

    return true;
  }

  private isPublicRoute(method: string, path: string): boolean {
    return this.publicRoutes.some(route => {
      if (route.method !== method) {
        return false;
      }

      return route.match === 'exact' ? route.path === path : path.startsWith(route.path);
    });
  }
}
