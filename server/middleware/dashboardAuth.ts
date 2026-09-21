import express from 'express';

/**
 * Optional dashboard authentication.
 *
 * When `DASHBOARD_TOKEN` is set in the environment, every `/api/*` endpoint
 * requires the same value sent as either `Authorization: Bearer <token>` or the
 * `x-dashboard-token` header. `/api/health` stays public so uptime monitors and
 * the anti-sleep heartbeat keep working.
 */
export function dashboardAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const expected = process.env.DASHBOARD_TOKEN;
  if (!expected) return next(); // auth disabled (local development)
  if (req.path === '/health') return next(); // keep health check public

  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const custom = String(req.headers['x-dashboard-token'] || '');
  const token = bearer || custom;

  if (token === expected) return next();
  return res.status(401).json({ error: 'Unauthorized: invalid or missing dashboard token' });
}
