import type { Request, Response, NextFunction } from 'express';
import { getAgentByKey, type AgentRecord } from '../store.js';

declare global {
  namespace Express {
    interface Request {
      agent?: AgentRecord;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authorization header required: Bearer YOUR_API_KEY' } });
    return;
  }

  const apiKey = header.slice(7);
  const agent = getAgentByKey(apiKey);
  if (!agent) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
    return;
  }

  req.agent = agent;
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const agent = getAgentByKey(header.slice(7));
    if (agent) req.agent = agent;
  }
  next();
}
