import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import {
  updateViewerCount,
  getAgentByStreamKey,
  getAgentByKey,
  addChatMessage,
} from '../store.js';

export interface WsMessage {
  type: 'chat' | 'tip' | 'viewer_count' | 'system' | 'connected';
  [key: string]: any;
}

interface ClientEntry {
  ws: WebSocket;
  streamKey: string;
  username: string;
  role: 'viewer' | 'streamer';
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

    // Resolve username: prefer agent auth via token, fall back to query param
    let username = url.searchParams.get('username') ?? 'Viewer';
    const token = url.searchParams.get('token');
    if (token) {
      const agent = getAgentByKey(token);
      if (agent) username = agent.name;
    }

    clients.set(ws, { ws, streamKey, username, role });

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

  setInterval(() => {
    const streams = new Set<string>();
    for (const entry of clients.values()) {
      streams.add(entry.streamKey);
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

  if (msg.type === 'chat' && typeof msg.message === 'string') {
    const text = msg.message.trim().slice(0, 500);
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
