import NodeMediaServer from 'node-media-server';
import { mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';
import { getAgentByStreamKey, setAgentLive } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEDIA_ROOT = join(__dirname, '..', 'media');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

mkdirSync(MEDIA_ROOT, { recursive: true });

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
};

const ffmpegProcesses = new Map<string, ChildProcess>();

function startHlsTranscode(streamKey: string): void {
  const outDir = join(MEDIA_ROOT, 'live', streamKey);
  mkdirSync(outDir, { recursive: true });

  // Owncast-aligned HLS transcode config (balanced latency tier: ~8-10s)
  // Keyframe interval = fps(30) × segment_duration(3) = 90 frames
  const SEGMENT_DURATION = 3;
  const ASSUMED_FPS = 30;
  const GOP = ASSUMED_FPS * SEGMENT_DURATION; // 90
  const SEGMENT_COUNT = 8;

  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-fflags', '+genpts',
    '-flags', '+cgop',
    '-i', `rtmp://127.0.0.1:1935/live/${streamKey}`,
    // Video: libx264 veryfast (Owncast default for software encode)
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-sc_threshold', '0',
    '-g', String(GOP),
    '-keyint_min', String(GOP),
    '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_DURATION})`,
    '-b:v', '4500k',
    '-maxrate', '4860k',
    '-bufsize', '9000k',
    // Audio: AAC 128k @ 44100 Hz
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    // HLS output
    '-f', 'hls',
    '-hls_time', String(SEGMENT_DURATION),
    '-hls_list_size', String(SEGMENT_COUNT),
    '-hls_flags', 'delete_segments+program_date_time+independent_segments+omit_endlist',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', join(outDir, 'seg%03d.ts'),
    '-max_muxing_queue_size', '400',
    join(outDir, 'index.m3u8'),
  ];

  const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  proc.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line && !line.startsWith('frame=')) {
      console.log(`[ffmpeg:${streamKey.slice(0, 8)}] ${line.slice(0, 200)}`);
    }
  });

  proc.on('close', (code) => {
    console.log(`[ffmpeg:${streamKey.slice(0, 8)}] exited code=${code}`);
    ffmpegProcesses.delete(streamKey);
  });

  ffmpegProcesses.set(streamKey, proc);
  console.log(`[media] ffmpeg HLS transcode started for ${streamKey.slice(0, 8)}…`);
}

function stopHlsTranscode(streamKey: string): void {
  const proc = ffmpegProcesses.get(streamKey);
  if (proc) {
    proc.kill('SIGTERM');
    ffmpegProcesses.delete(streamKey);
  }
  const outDir = join(MEDIA_ROOT, 'live', streamKey);
  setTimeout(() => {
    try { rmSync(outDir, { recursive: true, force: true }); } catch {}
  }, 2000);
}

let nms: any = null;

export function startMediaServer(): void {
  nms = new NodeMediaServer(config);

  nms.on('prePublish', (session: any) => {
    const streamPath: string = session.streamPath ?? '';
    const parts = streamPath.split('/');
    const streamKey = parts[parts.length - 1];
    const agent = getAgentByStreamKey(streamKey);

    if (!agent) {
      console.log(`[media] rejected unknown stream key: ${streamKey}`);
      session.close?.();
      return;
    }

    console.log(`[media] stream started: ${agent.name} (${streamKey.slice(0, 8)}…)`);
    setAgentLive(streamKey, true);
  });

  nms.on('postPublish', (session: any) => {
    const streamPath: string = session.streamPath ?? '';
    const parts = streamPath.split('/');
    const streamKey = parts[parts.length - 1];
    const agent = getAgentByStreamKey(streamKey);

    if (agent) {
      startHlsTranscode(streamKey);
    }
  });

  nms.on('donePublish', (session: any) => {
    const streamPath: string = session.streamPath ?? '';
    const parts = streamPath.split('/');
    const streamKey = parts[parts.length - 1];
    const agent = getAgentByStreamKey(streamKey);

    if (agent) {
      console.log(`[media] stream ended: ${agent.name}`);
      setAgentLive(streamKey, false);
      stopHlsTranscode(streamKey);
    }
  });

  nms.run();
  console.log(`[media] RTMP server on :1935 | HLS via ffmpeg`);
}

export function getMediaRoot(): string {
  return MEDIA_ROOT;
}
