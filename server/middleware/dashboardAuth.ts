import express from 'express';
import { timingSafeEqual } from 'node:crypto';

/**
 * Dashboard authentication.
 *
 * In production, every `/api/*` endpoint requires DASHBOARD_TOKEN. Local
 * development may omit it. `/api/health` stays public for uptime monitors.
 */
export function dashboardAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const expected = process.env.DASHBOARD_TOKEN;
  if (req.path === '/health' || req.path.startsWith('/stock')) return next(); // keep health check and public market data accessible
  if (!expected) {
    if (process.env.NODE_ENV !== 'production') return next();
    return res.status(503).json({ error: 'Dashboard API is locked: configure DASHBOARD_TOKEN on the server.' });
  }

  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const custom = String(req.headers['x-dashboard-token'] || '');
  const token = bearer || custom;

  const providedBytes = Buffer.from(token, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)) return next();
  return res.status(401).json({ error: 'Unauthorized: invalid or missing dashboard token' });
}
