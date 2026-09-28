# Server Architecture

Express backend for the CDC Action Zone V3 SET Thai stock bot.
Previously a single 1,394-line `server.ts`; now a layered structure.

## Layering

```
server/
├── index.ts                       # Entry point ONLY: app + security middleware + routes + listen
├── middleware/
│   ├── dashboardAuth.ts           # DASHBOARD_TOKEN required in production for /api/*
│   └── rateLimiters.ts            # generalLimiter, orderLimiter (shared with routes)
├── repositories/
│   └── stateRepository.ts         # ServerState shape + data/bot_state.json persistence
├── services/
│   ├── marketData.ts              # SET market hours + Yahoo Finance client (cache + backoff)
│   ├── telegram.service.ts        # Telegram Bot API alerts
│   └── tradingEngine.ts           # 24/7 automated bot cycle
├── routes/
│   ├── bot.routes.ts              # /api/bot/*  +  /api/telegram/test
│   ├── market.routes.ts           # /api/stock/*
│   ├── ai.routes.ts               # /api/ai/analyze, /api/ai-analyze
│   └── health.routes.ts           # /api/health (public)
└── utils/
    └── validation.ts              # sanitizeErrorMessage, sanitizeSymbol, VALID_SYMBOL_REGEX
```

**Dependency rule:** `routes → services → repositories → src/*`.
A layer never imports from a layer above it and `index.ts` is never imported by anything.

## Mounted route prefixes

| Prefix | Router | Endpoints |
|---|---|---|
| `/api/health` | `healthRouter` | `GET /` |
| `/api/bot` | `botRouter` | `GET /state`, `POST /config`, `/toggle`, `/manual-order`, `/close-position`, `/clear-logs`, `/reset-paper`, `/unlock-symbol` |
| `/api/telegram` | `telegramRouter` | `POST /test` |
| `/api/stock` | `marketRouter` | `GET /klines`, `/ticker`, `/depth`; `POST /balances`, `/order`, `/keys` |
| `/api` | `aiRouter` | `POST /ai/analyze`, `/ai-analyze` |

Middleware order in `index.ts` is significant and must not be reordered:
`helmet` → `cors` → `generalLimiter` → `express.json` → `dashboardAuth` → routers.

## Key design decisions

### 1. `getServerState()` returns the LIVE object
`stateRepository` keeps a module-level `let serverState`. `getServerState()` hands back that
same reference, so handlers can mutate nested properties in place:

```ts
const state = getServerState();
state.paperAccount.usdtBalance -= actualInvested;   // ✅ affects the real state
saveServerState();                                   // persist
```

Do **not** do `state = {...state}` inside a handler — reassign a *property* instead
(`state.paperAccount = ...`), or call `setServerState(next)` for a full replacement.

### 2. Trading engine has no import side effects
`startTradingEngine()` must be called explicitly (done in `index.ts#startServer`).
Importing `tradingEngine.ts` starts nothing, which makes it safe to import from scripts/tests
and guarantees the loop only starts after state has been loaded.

### 3. Import paths must stay relative
The production server bundle is produced by
`esbuild server/index.ts --bundle --platform=node --format=cjs`, which has **no path-alias
configuration**. The Vite alias `@` therefore does not apply inside `server/` — always use
relative imports (`../../src/...`).

### 4. Console/logging
User-visible bot activity goes to `addServerLog()` (ring buffer of 200, surfaced in the UI).
Developer diagnostics use `console.log/warn/error`.

## Commands

```bash
npm run dev     # tsx server/index.ts   (dev, Vite middleware mode)
npm run build   # vite build + esbuild bundle -> dist/server.cjs
npm start       # node dist/server.cjs  (production; serves dist/ statically)
npm run lint    # tsc --noEmit
```

`render.yaml` deploys via `npm install && npm run build` + `npm start`, so the bundle output
path (`dist/server.cjs`) is part of the contract — do not rename it.

## Known follow-ups

- `routes/bot.routes.ts` and `services/tradingEngine.ts` still duplicate the open/close
  position bookkeeping (PnL math, `ExecutedTrade` construction, Telegram wording). Extract a
  `services/paperTradingService.ts` to share it.
- `/api/stock/depth`, `/api/stock/balances`, and `/api/stock/order` explicitly return HTTP 501 until real market-depth/broker adapters exist; they never return fabricated success/data.
- Live bot mode and manual live orders are disabled. The trading engine fails closed to Paper mode.
- In production, set `DASHBOARD_TOKEN`; set a stable `LIVE_KEYS_ENCRYPTION_KEY` (at least 32 characters) before saving broker or Telegram secrets. Secrets are AES-256-GCM encrypted at rest and are never stored in browser local storage.
- `marketData.ts` holds its cache/backoff in module scope; if the process is ever scaled
  horizontally, that state must move to a shared store.
