import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import {
  getAgentByName,
  updateAgent,
  followAgent,
  unfollowAgent,
  getFollowers,
  getFollowing,
  isFollowing,
} from '../../store.js';

const router = Router();

router.use(rateLimit(100));

// --- Register (INVITE ONLY) ---

router.post('/register', (req: Request, res: Response) => {
  res.status(403).json({
    error: {
      code: 'INVITE_ONLY',
      message: 'Registration is currently invite-only. Check back soon!',
    },
  });
});

// --- Profile: me ---

router.get('/me', requireAuth, (req: Request, res: Response) => {
  const a = req.agent!;
  res.json({
    data: {
      name: a.name,
      description: a.description,
      shielded_address: a.shieldedAddress,
      avatar_url: a.avatarUrl,
      stream_key: a.streamKey,
      title: a.title,
      category: a.category,
      is_live: a.isLive,
      viewer_count: a.viewerCount,
      created_at: a.createdAt,
    },
  });
});

router.patch('/me', requireAuth, (req: Request, res: Response) => {
  const { description, shielded_address, avatar_url } = req.body as {
    description?: string;
    shielded_address?: string;
    avatar_url?: string;
  };

  const updated = updateAgent(req.agent!.apiKey, {
    description: description !== undefined ? String(description).slice(0, 280) : undefined,
    shieldedAddress: shielded_address,
    avatarUrl: avatar_url,
  });

  if (!updated) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    return;
  }

  res.json({
    data: {
      name: updated.name,
      description: updated.description,
      shielded_address: updated.shieldedAddress,
      avatar_url: updated.avatarUrl,
    },
  });
});

// --- Status ---

router.get('/status', requireAuth, (req: Request, res: Response) => {
  res.json({ data: { status: 'active', name: req.agent!.name } });
});

// --- Profile: by name ---

router.get('/profile', (req: Request, res: Response) => {
  const name = req.query.name as string | undefined;
  if (!name) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'name query parameter required' } });
    return;
  }

  const agent = getAgentByName(name);
  if (!agent) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    return;
  }

  res.json({
    data: {
      name: agent.name,
      description: agent.description,
      avatar_url: agent.avatarUrl,
      stream_key: agent.streamKey,
      title: agent.title,
      category: agent.category,
      is_live: agent.isLive,
      viewer_count: agent.viewerCount,
      created_at: agent.createdAt,
    },
  });
});

// --- Follow / Unfollow ---

router.post('/:name/follow', requireAuth, (req: Request, res: Response) => {
  const targetName = req.params.name;
  const followerName = req.agent!.name;

  if (followerName.toLowerCase() === targetName.toLowerCase()) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Cannot follow yourself' } });
    return;
  }

  if (isFollowing(followerName, targetName)) {
    res.json({ data: { following: true, message: 'Already following' } });
    return;
  }

  const ok = followAgent(followerName, targetName);
  if (!ok) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    return;
  }

  res.json({ data: { following: true } });
});

router.delete('/:name/follow', requireAuth, (req: Request, res: Response) => {
  unfollowAgent(req.agent!.name, req.params.name);
  res.json({ data: { following: false } });
});

// --- Followers ---

router.get('/:name/followers', (req: Request, res: Response) => {
  const agent = getAgentByName(req.params.name);
  if (!agent) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    return;
  }

  const list = getFollowers(req.params.name);
  res.json({ data: { followers: list, count: list.length } });
});

router.get('/:name/following', (req: Request, res: Response) => {
  const agent = getAgentByName(req.params.name);
  if (!agent) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    return;
  }

  const list = getFollowing(req.params.name);
  res.json({ data: { following: list, count: list.length } });
});

export default router;
