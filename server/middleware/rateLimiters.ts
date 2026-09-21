import rateLimit from 'express-rate-limit';

/**
 * Cross-cutting rate limiters.
 *
 * They live in their own module because both the app bootstrap
 * (`server/index.ts`) and the market routes (`server/routes/market.routes.ts`)
 * need the same limiter instances.
 */

/** Global limiter applied to every /api/* request. */
export const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

/** Stricter limiter for order placement endpoints. */
export const orderLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Order rate limit exceeded.' },
});
