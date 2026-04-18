import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

import { extractBearerToken, verifyAccessToken } from '@ngola/shared';

@Injectable()
export class VideoAuthGuard implements CanActivate {
  private readonly accessSecret = process.env.AUTH_JWT_ACCESS_SECRET ?? 'dev-access-secret';
  private readonly publicPaths = new Set(['/api/v1/health', '/api/v1/webhooks/livekit']);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();
    const path = (request.originalUrl || request.url || '').split('?')[0];

    if (method === 'OPTIONS' || this.publicPaths.has(path)) {
      return true;
    }

    const token =
      extractBearerToken(request.headers.authorization) ?? this.extractDemoAccessToken(method, path, request);
    if (!token) {
      throw new UnauthorizedException('missing bearer token');
    }

    try {
      verifyAccessToken(token, this.accessSecret);
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : 'invalid access token');
    }

    return true;
  }

  private extractDemoAccessToken(method: string, path: string, request: Request): string | undefined {
    if (method !== 'GET' || !/^\/api\/v1\/meetings\/[^/]+\/demo$/.test(path)) {
      return undefined;
    }

    const candidate = request.query?.accessToken;
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : undefined;
  }
}
