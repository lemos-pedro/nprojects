import { createHmac, timingSafeEqual } from 'crypto';

export type AccessTokenPayload = {
  sub: string;
  exp: number;
  typ: 'access';
};

export function extractBearerToken(authorization?: string): string | undefined {
  if (!authorization?.startsWith('Bearer ')) {
    return undefined;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature) {
    throw new Error('invalid access token');
  }

  const expectedSignature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error('invalid access token');
  }

  let payload: { sub?: unknown; exp?: unknown; typ?: unknown };
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      sub?: unknown;
      exp?: unknown;
      typ?: unknown;
    };
  } catch {
    throw new Error('invalid access token');
  }

  if (
    typeof payload.sub !== 'string' ||
    typeof payload.exp !== 'number' ||
    payload.typ !== 'access' ||
    payload.exp * 1000 < Date.now()
  ) {
    throw new Error('access token expired or invalid');
  }

  return {
    sub: payload.sub,
    exp: payload.exp,
    typ: 'access',
  };
}
