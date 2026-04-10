import { randomBytes } from 'crypto';

export interface StreamerRecord {
  streamKey: string;
  displayName: string;
  title: string;
  category: string;
  shieldedAddress: string;
  authToken: string;
  isLive: boolean;
  viewerCount: number;
  createdAt: number;
}

const streamers = new Map<string, StreamerRecord>();

function generateKey(): string {
  return randomBytes(16).toString('hex');
}

export function registerStreamer(displayName: string, shieldedAddress: string): StreamerRecord {
  const streamKey = generateKey();
  const authToken = generateKey();

  const record: StreamerRecord = {
    streamKey,
    displayName,
    title: `${displayName}'s stream`,
    category: 'Just Chatting',
    shieldedAddress,
    authToken,
    isLive: false,
    viewerCount: 0,
    createdAt: Date.now(),
  };

  streamers.set(streamKey, record);
  console.log(`[registry] registered streamer "${displayName}" key=${streamKey.slice(0, 8)}…`);
  return record;
}

export function getStreamer(streamKey: string): StreamerRecord | undefined {
  return streamers.get(streamKey);
}

export function getStreamerByAuth(authToken: string): StreamerRecord | undefined {
  for (const s of streamers.values()) {
    if (s.authToken === authToken) return s;
  }
  return undefined;
}

export function setStreamerLive(streamKey: string, isLive: boolean): void {
  const s = streamers.get(streamKey);
  if (s) {
    s.isLive = isLive;
    if (!isLive) s.viewerCount = 0;
  }
}

export function updateViewerCount(streamKey: string, count: number): void {
  const s = streamers.get(streamKey);
  if (s) s.viewerCount = count;
}

export function updateStreamerInfo(streamKey: string, title?: string, category?: string): void {
  const s = streamers.get(streamKey);
  if (!s) return;
  if (title !== undefined) s.title = title;
  if (category !== undefined) s.category = category;
}

export function getLiveStreamers(): StreamerRecord[] {
  return Array.from(streamers.values()).filter((s) => s.isLive);
}

export function getAllStreamers(): StreamerRecord[] {
  return Array.from(streamers.values());
}
