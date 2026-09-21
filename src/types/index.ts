/**
 * Barrel re-export for all shared domain types.
 *
 * Types live in per-domain files so a feature can import only its own domain
 * (e.g. `import { BotConfig } from '../types/bot.types'`). This barrel keeps the
 * historical `from '../types'` path working for every existing consumer
 * (App, components, lib and the Express server), so the split is a pure
 * re-organisation with no consumer churn.
 */

export * from './market.types';
export * from './bot.types';
export * from './scanner.types';
export * from './backtest.types';
export * from './ai.types';
