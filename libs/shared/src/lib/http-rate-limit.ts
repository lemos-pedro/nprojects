import { NextFunction, Request, Response } from 'express';

export type RateLimitRule = {
  name: string;
  pathPrefix?: string;
  methods?: string[];
  windowMs: number;
  maxRequests: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  defaultRule: RateLimitRule;
  rules?: RateLimitRule[];
  skipPathPrefixes?: string[];
  keyHeader?: string;
};

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.split('?')[0] || '/';
}

function selectRule(path: string, method: string, options: RateLimitOptions): RateLimitRule {
  for (const rule of options.rules ?? []) {
    if (rule.pathPrefix && !path.startsWith(rule.pathPrefix)) {
      continue;
    }
    if (rule.methods?.length && !rule.methods.includes(method)) {
      continue;
    }
    return rule;
  }
  return options.defaultRule;
}

export function createRateLimitMiddleware(service: string, options: RateLimitOptions) {
  const cache = new Map<string, RateLimitEntry>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const path = normalizePath(req.originalUrl || req.url);

    if (options.skipPathPrefixes?.some(prefix => path.startsWith(prefix))) {
      next();
      return;
    }

    const method = req.method.toUpperCase();
    const rule = selectRule(path, method, options);
    const now = Date.now();
    const identityHeader =
      options.keyHeader && typeof req.headers[options.keyHeader] === 'string'
        ? String(req.headers[options.keyHeader])
        : undefined;
    const identity = identityHeader?.trim() || req.ip || 'unknown';
    const key = `${rule.name}:${identity}`;
    const current = cache.get(key);

    if (!current || current.resetAt <= now) {
      cache.set(key, {
        count: 1,
        resetAt: now + rule.windowMs,
      });
      res.setHeader('x-ratelimit-limit', String(rule.maxRequests));
      res.setHeader('x-ratelimit-remaining', String(rule.maxRequests - 1));
      res.setHeader('x-ratelimit-reset', String(Math.ceil((now + rule.windowMs) / 1000)));
      next();
      return;
    }

    current.count += 1;
    const remaining = Math.max(rule.maxRequests - current.count, 0);
    res.setHeader('x-ratelimit-limit', String(rule.maxRequests));
    res.setHeader('x-ratelimit-remaining', String(remaining));
    res.setHeader('x-ratelimit-reset', String(Math.ceil(current.resetAt / 1000)));

    if (current.count > rule.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('retry-after', String(retryAfterSeconds));
      res.status(429).json({
        statusCode: 429,
        message: 'too many requests',
        service,
      });
      return;
    }

    if (cache.size > 50_000) {
      for (const [entryKey, entryValue] of cache.entries()) {
        if (entryValue.resetAt <= now) {
          cache.delete(entryKey);
        }
      }
    }

    next();
  };
}
