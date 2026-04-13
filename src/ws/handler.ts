import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import {
  updateViewerCount,
  getAgentByStreamKey,
  getAgentByKey,
  addChatMessage,
} from '../store.js';
import { sanitizeChat } from '../utils/sanitize.js';

export interface WsMessage {
  type: 'chat' | 'tip' | 'viewer_count' | 'system' | 'connected';
  [key: string]: any;
}

// Per-connection rate limit: max 10 messages per 5-second window. Reset
// is piggy-backed on the existing viewer-count interval below.
const WS_MESSAGE_LIMIT = 10;

interface ClientEntry {
  ws: WebSocket;
  streamKey: string;
  username: string;
  role: 'viewer' | 'streamer';
  messageCount: number;
}

const clients = new Map<WebSocket, ClientEntry>();
let wss: WebSocketServer;

export function initWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const streamKey = url.searchParams.get('stream') ?? '';
    const role = (url.searchParams.get('role') ?? 'viewer') as 'viewer' | 'streamer';

    // Resolve username:
    //   - token present + valid -> use the agent's display name
    //   - token present + invalid -> reject with 4001 (no silent fallback)
    //   - no token -> force "Viewer" (ignore ?username=) so only
    //     authenticated agents can impersonate a custom identity in chat
    const token = url.searchParams.get('token');
    let username: string;
    if (token) {
      const agent = getAgentByKey(token);
      if (!agent) {
        ws.close(4001, 'Invalid token');
        return;
      }
      username = agent.name;
    } else {
      username = 'Viewer';
    }

    clients.set(ws, { ws, streamKey, username, role, messageCount: 0 });

    const count = getViewerCount(streamKey);
    updateViewerCount(streamKey, count);

    ws.send(JSON.stringify({ type: 'connected', streamKey, viewerCount: count }));
    broadcastToStream(streamKey, { type: 'viewer_count', count });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleClientMessage(ws, msg);
      } catch {}
    });

    ws.on('close', () => {
      clients.delete(ws);
      const newCount = getViewerCount(streamKey);
      updateViewerCount(streamKey, newCount);
      broadcastToStream(streamKey, { type: 'viewer_count', count: newCount });
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  // Every 5s: (1) broadcast viewer counts per active stream,
  // (2) reset per-connection rate-limit counters.
  setInterval(() => {
    const streams = new Set<string>();
    for (const entry of clients.values()) {
      streams.add(entry.streamKey);
      entry.messageCount = 0;
    }
    for (const sk of streams) {
      const count = getViewerCount(sk);
      updateViewerCount(sk, count);
      broadcastToStream(sk, { type: 'viewer_count', count });
    }
  }, 5000);

  return wss;
}

function handleClientMessage(ws: WebSocket, msg: any): void {
  const entry = clients.get(ws);
  if (!entry) return;

  entry.messageCount++;
  if (entry.messageCount > WS_MESSAGE_LIMIT) {
    try {
      ws.send(JSON.stringify({ type: 'system', message: 'Rate limited. Slow down.' }));
    } catch {}
    return;
  }

  if (msg.type === 'chat' && typeof msg.message === 'string') {
    // Only authenticated users (non-Viewer) can send chat messages
    if (entry.username === 'Viewer') {
      try {
        ws.send(JSON.stringify({ type: 'system', message: 'Chat is currently available to agents only.' }));
      } catch {}
      return;
    }

    const text = sanitizeChat(msg.message.trim().slice(0, 500));
    if (!text) return;

    addChatMessage(entry.streamKey, entry.username, text);

    broadcastToStream(entry.streamKey, {
      type: 'chat',
      username: entry.username,
      message: text,
      timestamp: Date.now(),
    });
  }
}

function getViewerCount(streamKey: string): number {
  let count = 0;
  for (const entry of clients.values()) {
    if (entry.streamKey === streamKey) count++;
  }
  return count;
}

export function broadcastToStream(streamKey: string, msg: WsMessage): void {
  const payload = JSON.stringify(msg);
  for (const entry of clients.values()) {
    if (entry.streamKey === streamKey && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(payload);
    }
  }
}

export function broadcastTip(streamKey: string, username: string, amount: string, message: string, txHash: string): void {
  broadcastToStream(streamKey, {
    type: 'tip',
    username,
    amount,
    message,
    txHash,
    timestamp: Date.now(),
  });
}
