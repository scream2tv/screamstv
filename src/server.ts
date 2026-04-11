import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import v1Router from './routes/v1/index.js';
import apiRouter from './routes/api.js';
import { initWebSocket } from './ws/handler.js';
import { startMediaServer, getMediaRoot } from './media-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

const publicDir = join(__dirname, '..', 'public');

// Serve skill.md at root for agent onboarding
app.get('/skill.md', (_req, res) => {
  res.type('text/markdown').sendFile(join(publicDir, 'skill.md'));
});

app.use(express.static(publicDir));

app.use('/media', express.static(getMediaRoot(), {
  setHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
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
