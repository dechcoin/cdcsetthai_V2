import express from 'express';
import { getServerState } from '../repositories/stateRepository';
import { isThaiMarketOpen } from '../services/marketData';

/** `/api/health` — public uptime probe (also used by the anti-sleep heartbeat). */
export const healthRouter = express.Router();

healthRouter.get('/', (req, res) => {
  return res.json({
    status: 'ok',
    system: 'CDC Action Zone V3 SET Thai Stock Bot',
    uptime: process.uptime(),
    isBotActive: getServerState().botConfig.isActive,
    marketOpen: isThaiMarketOpen(),
    time: new Date().toISOString(),
  });
});
