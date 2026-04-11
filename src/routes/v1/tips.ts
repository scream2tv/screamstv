import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import {
  getAgentByStreamKey,
  addTipRecord,
  getTipHistory,
} from '../../store.js';
import { broadcastTip } from '../../ws/handler.js';
import { sanitizeChat } from '../../utils/sanitize.js';

const router = Router();

// --- Notify tip ---

router.post(
  '/:streamKey/tip',
  rateLimit(5),
  requireAuth,
  (req: Request, res: Response) => {
    const { streamKey } = req.params;
    const { amount, message } = req.body as { amount?: string; message?: string };

    const stream = getAgentByStreamKey(streamKey);
    if (!stream) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Stream not found' } });
      return;
    }

    if (!amount) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'amount is required' } });
      return;
    }

    const username = req.agent!.name;
    const tipMessage = sanitizeChat((message ?? '').slice(0, 280));

    const record = addTipRecord(streamKey, username, amount, tipMessage);

    broadcastTip(streamKey, username, amount, tipMessage, '');

    console.log(`[api] tip: ${amount} tNIGHT from ${username} -> ${stream.name}`);

    res.status(201).json({ data: record });
  },
);

// --- Tip history ---

router.get('/:streamKey/tips', (req: Request, res: Response) => {
  const { streamKey } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 25, 200);

  const stream = getAgentByStreamKey(streamKey);
  if (!stream) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Stream not found' } });
    return;
  }

  const tips = getTipHistory(streamKey, limit);
  res.json({ data: tips });
});

export default router;
