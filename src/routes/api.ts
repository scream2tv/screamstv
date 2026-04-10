import { Router, type Request, type Response } from 'express';
import { broadcastTip } from '../ws/handler.js';
import {
  registerAgent,
  getAgentByStreamKey,
  updateStreamInfo,
  updateAgent,
  getLiveAgents,
  getAllAgents,
} from '../store.js';

const router = Router();

const SHIELDED_ADDR_RE = /^mn_shield-addr_(mainnet|preprod|preview)1[a-z0-9]{50,200}$/;

// Legacy routes kept for backward compatibility with HTML dashboard/browse pages.
// New integrations should use /api/v1 instead.

// --- Streamer Registration ---

router.post('/streamer/register', (req: Request, res: Response) => {
  try {
    const { displayName, shieldedAddress } = req.body as {
      displayName?: string;
      shieldedAddress?: string;
    };

    if (!displayName || displayName.trim().length < 1) {
      res.status(400).json({ error: 'displayName is required' });
      return;
    }
    if (!shieldedAddress || !SHIELDED_ADDR_RE.test(shieldedAddress)) {
      res.status(400).json({ error: 'A valid Midnight shielded address is required' });
      return;
    }

    const record = registerAgent(displayName.trim(), '');
    updateAgent(record.apiKey, { shieldedAddress });

    res.json({
      streamKey: record.streamKey,
      authToken: record.apiKey,
      displayName: record.name,
      shieldedAddress: record.shieldedAddress,
      rtmpUrl: `rtmp://localhost:1935/live/${record.streamKey}`,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Public Streamer Info ---

router.get('/streamer/:streamKey/info', (req: Request, res: Response) => {
  const agent = getAgentByStreamKey(req.params.streamKey);
  if (!agent) {
    res.status(404).json({ error: 'Streamer not found' });
    return;
  }

  res.json({
    displayName: agent.name,
    title: agent.title,
    category: agent.category,
    isLive: agent.isLive,
    viewerCount: agent.viewerCount,
    shieldedAddress: agent.shieldedAddress,
  });
});

// --- Update Stream Info (auth required) ---

router.put('/streamer/:streamKey/info', (req: Request, res: Response) => {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) {
    res.status(401).json({ error: 'Authorization required' });
    return;
  }

  const agent = getAgentByStreamKey(req.params.streamKey);
  if (!agent || agent.apiKey !== auth) {
    res.status(403).json({ error: 'Invalid credentials' });
    return;
  }

  const { title, category } = req.body as { title?: string; category?: string };
  updateStreamInfo(req.params.streamKey, title, category);

  res.json({ success: true });
});

// --- Browse: list streams ---

router.get('/streams', (_req: Request, res: Response) => {
  const all = getAllAgents();
  const list = all.map((s) => ({
    streamKey: s.streamKey,
    displayName: s.name,
    title: s.title,
    category: s.category,
    isLive: s.isLive,
    viewerCount: s.viewerCount,
  }));
  res.json(list);
});

router.get('/streams/live', (_req: Request, res: Response) => {
  const live = getLiveAgents();
  const list = live.map((s) => ({
    streamKey: s.streamKey,
    displayName: s.name,
    title: s.title,
    category: s.category,
    viewerCount: s.viewerCount,
  }));
  res.json(list);
});

// --- Tip Notification ---

router.post('/tip/notify', (req: Request, res: Response) => {
  try {
    const { streamKey, amount, message, username } = req.body as {
      streamKey?: string;
      amount?: string;
      message?: string;
      username?: string;
    };

    if (!streamKey) {
      res.status(400).json({ error: 'streamKey is required' });
      return;
    }

    const agent = getAgentByStreamKey(streamKey);
    if (!agent) {
      res.status(404).json({ error: 'Streamer not found' });
      return;
    }

    console.log(`[api] tip notification: ${amount} tNIGHT -> ${agent.name}`);

    broadcastTip(
      streamKey,
      username ?? 'Anonymous',
      amount ?? '0',
      (message ?? '').slice(0, 280),
      '',
    );

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
