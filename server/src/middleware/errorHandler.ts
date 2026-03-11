/**
 * Centralized error handler — prevents stack traces and internal details
 * from leaking to clients in production.
 */

import type { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message || 'Internal server error';

  console.error(`[errorHandler] ${status}:`, err.message || err);

  res.status(status).json({ error: message });
}
