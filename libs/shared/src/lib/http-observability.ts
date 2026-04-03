import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

type LoggerLevel = 'info' | 'warn' | 'error';

export type RequestWithContext = Request & {
  requestId?: string;
  startTimeMs?: number;
};

function sanitizePath(path: string): string {
  if (!path) return '/';
  return path.split('?')[0] || '/';
}

function levelForStatus(statusCode: number): LoggerLevel {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

function logJson(level: LoggerLevel, payload: Record<string, unknown>): void {
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function createHttpObservabilityMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const observedReq = req as RequestWithContext;
    const incomingId =
      typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined;
    const requestId = incomingId || randomUUID();
    const startTimeMs = Date.now();

    observedReq.requestId = requestId;
    observedReq.startTimeMs = startTimeMs;

    res.setHeader('x-request-id', requestId);

    logJson('info', {
      level: 'info',
      event: 'http_request_start',
      service: serviceName,
      requestId,
      method: req.method,
      path: sanitizePath(req.originalUrl || req.url),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString(),
    });

    res.on('finish', () => {
      const durationMs = Date.now() - startTimeMs;
      const level = levelForStatus(res.statusCode);
      logJson(level, {
        level,
        event: 'http_request_end',
        service: serviceName,
        requestId,
        method: req.method,
        path: sanitizePath(req.originalUrl || req.url),
        statusCode: res.statusCode,
        durationMs,
        contentLength: res.getHeader('content-length'),
        timestamp: new Date().toISOString(),
      });
    });

    next();
  };
}
