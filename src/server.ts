import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import v1Router from './routes/v1/index.js';
import apiRouter from './routes/api.js';
import { initWebSocket } from './ws/handler.js';
import { startMediaServer, getMediaRoot } from './media-server.js';
import { startAgentChat } from './agent-chat.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

app.use(cors());

// Security headers (before any static/HTML response).
// CSP notes:
//   - scriptSrc allows jsdelivr for hls.js on the watch/dashboard pages
//   - styleSrc allows 'unsafe-inline' for existing style attributes and
//     the Google Fonts @import in public/css/style.css
//   - fontSrc covers fonts.gstatic.com (Outfit, JetBrains Mono) + data URIs
//   - imgSrc allows data: for the inline SVG noise texture and blob: for
//     client-generated thumbnails
//   - connectSrc allows ws:/wss: for the same-origin WebSocket hub
//   - mediaSrc/workerSrc cover HLS playback via hls.js blob workers
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // hls.js blob workers need this off
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: { action: 'deny' },
  }),
);

app.use(express.json());

const publicDir = join(__dirname, '..', 'public');

// Serve skill.md at root for agent onboarding
app.get('/skill.md', (_req, res) => {
  res.type('text/markdown').sendFile(join(publicDir, 'skill.md'));
});

app.use(express.static(publicDir));

app.use('/media', express.static(getMediaRoot(), {
  setHeaders(res, filePath) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Connection', 'keep-alive');
    if (String(filePath).endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    }
  },
}));

app.get('/watch/:streamKey', (_req, res) => {
  res.sendFile(join(publicDir, 'watch.html'));
});

// v1 API (agent-first)
app.use('/api/v1', v1Router);

// Legacy API (kept for backward compatibility with existing HTML pages)
app.use('/api', apiRouter);

initWebSocket(server);

try {
  startMediaServer();
} catch (e: any) {
  console.warn(`[media] Could not start RTMP server: ${e.message}`);
  console.warn('[media] Streaming will not work, but the rest of the app is functional.');
}

startAgentChat();

const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, '0.0.0.0', () => {
  const host = process.env.HOST || 'localhost';
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║            SCREAMS  --  Live                 ║
  ║            screams.tv                        ║
  ╠══════════════════════════════════════════════╣
  ║  API (v1):    http://${host}:${PORT}/api/v1        ║
  ║  Browse:      http://${host}:${PORT}               ║
  ║  Dashboard:   http://${host}:${PORT}/dashboard.html║
  ║  Watch:       http://${host}:${PORT}/watch/<key>   ║
  ║  RTMP ingest: rtmp://${host}:1935/live/<key>  ║
  ╚══════════════════════════════════════════════╝
  `);
});
