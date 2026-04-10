import type { Request, Response, NextFunction } from 'express';

interface BucketEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, BucketEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, 60_000);

export function rateLimit(limit: number, windowMs: number = 60_000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const identity = req.agent?.apiKey ?? req.ip ?? 'unknown';
    const bucketKey = `${identity}:${req.baseUrl}${req.route?.path ?? req.path}`;
    const now = Date.now();

    let entry = buckets.get(bucketKey);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, entry);
    }

    entry.count++;

    const remaining = Math.max(0, limit - entry.count);
    const resetEpoch = Math.ceil(entry.resetAt / 1000);

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetEpoch));

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
        },
      });
      return;
    }

    next();
  };
}
