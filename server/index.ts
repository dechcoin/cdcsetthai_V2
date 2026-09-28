import express from 'express';
import path from 'path';
import fs from 'fs';
import helmet from 'helmet';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';

import { dashboardAuth } from './middleware/dashboardAuth';
import { generalLimiter } from './middleware/rateLimiters';
import { loadServerState } from './repositories/stateRepository';
import { startTradingEngine } from './services/tradingEngine';
import { aiRouter } from './routes/ai.routes';
import { botRouter, telegramRouter } from './routes/bot.routes';
import { healthRouter } from './routes/health.routes';
import { marketRouter } from './routes/market.routes';

/**
 * Application entry point.
 *
 * Responsibilities (and nothing else):
 * 1. Build the Express app and register security middleware
 * 2. Load persisted state
 * 3. Mount the feature routers
 * 4. Start background services (trading engine, anti-sleep heartbeat)
 * 5. Boot the HTTP listener and wire Vite (dev) or the built `dist/` (prod)
 *
 * Business logic lives in `services/`, persistence in `repositories/` and HTTP
 * handlers in `routes/` — see `server/README-architecture.md`.
 */

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// ==================== SECURITY MIDDLEWARE ====================

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-dashboard-token'],
    credentials: false,
  })
);

app.use('/api/', generalLimiter);
app.use(express.json({ limit: '200kb' }));

// Dashboard authentication is mandatory in production; local development may omit the token.
app.use('/api/', dashboardAuth);

// ==================== STATE + ROUTE REGISTRATION ====================

// Load the persisted state before anything can read it.
loadServerState();

app.use('/api/health', healthRouter);
app.use('/api/bot', botRouter);
app.use('/api/telegram', telegramRouter);
app.use('/api/stock', marketRouter);
app.use('/api', aiRouter);

// Self-ping heartbeat every 10 minutes to prevent server sleeping
const RENDER_APP_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_APP_URL) {
  setInterval(async () => {
    try {
      await fetch(`${RENDER_APP_URL}/api/health`);
      console.log('💓 Anti-sleep heartbeat self-ping successful.');
    } catch (e) {
      console.warn('Heartbeat ping failed:', e);
    }
  }, 10 * 60 * 1000);
}

// ==================== VITE & SERVER LAUNCH ====================

async function startServer() {
  const possibleDistDirs = [
    __dirname,
    path.join(process.cwd(), 'dist'),
    path.join(__dirname, '..', 'dist'),
    path.join(__dirname, 'dist'),
  ];
  const distPath = possibleDistDirs.find((d) => fs.existsSync(path.join(d, 'index.html')));

  if (!distPath && process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (distPath) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    console.error('Neither Vite dev server nor built dist directory could be initialized.');
  }

  // Start the 24/7 automated trading loop once the HTTP layer is ready.
  startTradingEngine();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 CDC Action Zone V3 SET Thai Stock Bot Server running on port ${PORT}`);
  });
}

startServer();
