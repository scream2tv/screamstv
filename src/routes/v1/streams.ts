import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import {
  getAllAgents,
  getLiveAgents,
  getAgentByStreamKey,
  updateStreamInfo,
  searchAgents,
} from '../../store.js';

const router = Router();

router.use(rateLimit(100));

function agentToStreamPayload(a: ReturnType<typeof getAgentByStreamKey> & {}) {
  return {
    stream_key: a.streamKey,
    name: a.name,
    title: a.title,
    category: a.category,
    description: a.description,
    is_live: a.isLive,
    viewer_count: a.viewerCount,
    shielded_address: a.shieldedAddress || undefined,
    avatar_url: a.avatarUrl || undefined,
    created_at: a.createdAt,
  };
}

// --- Browse all ---

router.get('/', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const all = getAllAgents();
  res.json({ data: all.slice(0, limit).map(agentToStreamPayload) });
});

// --- Live only ---

router.get('/live', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const live = getLiveAgents();
  res.json({ data: live.slice(0, limit).map(agentToStreamPayload) });
});

// --- Update own stream ---

router.put('/me', requireAuth, (req: Request, res: Response) => {
  const { title, category } = req.body as { title?: string; category?: string };
  updateStreamInfo(req.agent!.streamKey, title, category);
  res.json({
    data: {
      title: req.agent!.title,
      category: req.agent!.category,
    },
  });
});

// --- Search ---

router.get('/search', (req: Request, res: Response) => {
  const q = (req.query.q as string) ?? '';
  const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);

  if (!q.trim()) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'q query parameter required' } });
    return;
  }

  const results = searchAgents(q).slice(0, limit);
  res.json({ data: results.map(agentToStreamPayload) });
});

// --- Single stream ---

router.get('/:streamKey', (req: Request, res: Response) => {
  const agent = getAgentByStreamKey(req.params.streamKey);
  if (!agent) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Stream not found' } });
    return;
  }

  res.json({ data: agentToStreamPayload(agent) });
});

export default router;
