import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Request } from 'express';

type AccessTokenPayload = {
  sub: string;
  exp: number;
  typ: string;
};

@Injectable()
export class ProjectAuthGuard implements CanActivate {
  private readonly accessSecret = process.env.AUTH_JWT_ACCESS_SECRET ?? 'dev-access-secret';
  private readonly internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  private readonly publicPaths = new Set(['/api/v1/project-service/health', '/api/v1/billing/webhooks/stripe']);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();
    const path = (request.originalUrl || request.url || '').split('?')[0];

    if (method === 'OPTIONS' || this.publicPaths.has(path)) {
      return true;
    }

    const internalHeader = request.headers['x-internal-service-token'];
    const internalToken =
      typeof internalHeader === 'string'
        ? internalHeader
        : Array.isArray(internalHeader)
          ? internalHeader[0]
          : undefined;

    if (this.internalServiceToken && internalToken === this.internalServiceToken) {
      return true;
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }

    const token = authorization.slice('Bearer '.length).trim();
    const payload = this.verifyAccessToken(token);
    if (!payload.sub) {
      throw new UnauthorizedException('invalid access token');
    }

    return true;
  }

  private verifyAccessToken(token: string): AccessTokenPayload {
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

    let payload: AccessTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AccessTokenPayload;
    } catch {
      throw new UnauthorizedException('invalid access token');
    }

    if (payload.typ !== 'access' || payload.exp * 1000 < Date.now()) {
      throw new UnauthorizedException('access token expired or invalid');
    }

    return payload;
  }
}
