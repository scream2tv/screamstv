import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import {
  getAgentByStreamKey,
  addChatMessage,
  getChatHistory,
} from '../../store.js';
import { broadcastToStream } from '../../ws/handler.js';

const router = Router();

// --- Send chat message via REST ---

router.post(
  '/:streamKey/chat',
  rateLimit(10),
  requireAuth,
  (req: Request, res: Response) => {
    const { streamKey } = req.params;
    const { message } = req.body as { message?: string };

    const stream = getAgentByStreamKey(streamKey);
    if (!stream) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Stream not found' } });
      return;
    }

    const text = (message ?? '').trim().slice(0, 500);
    if (!text) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'message is required' } });
      return;
    }

    const record = addChatMessage(streamKey, req.agent!.name, text);

    broadcastToStream(streamKey, {
      type: 'chat',
      username: req.agent!.name,
      message: text,
      timestamp: record.timestamp,
    });

    res.status(201).json({ data: record });
  },
);

// --- Chat history ---

router.get('/:streamKey/chat', (req: Request, res: Response) => {
  const { streamKey } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

  const stream = getAgentByStreamKey(streamKey);
  if (!stream) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Stream not found' } });
    return;
  }

  const messages = getChatHistory(streamKey, limit);
  res.json({ data: messages });
});

export default router;
