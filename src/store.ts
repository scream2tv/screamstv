// Screams — Data access layer
//
// SQLite-backed implementation of the same exports the rest of the app
// depends on. Every function signature here is preserved from the previous
// in-memory implementation so callers (routes, middleware, ws) need no
// changes. The database itself lives in src/db.ts.
//
// See src/db.ts for schema and deliberate column-naming deviations from
// the original Maps-based layout.

import { randomBytes } from 'crypto';
import { db } from './db.js';

// --- Types ---

export interface AgentRecord {
  name: string;
  description: string;
  apiKey: string;
  streamKey: string;
  shieldedAddress: string;
  avatarUrl: string;
  title: string;
  category: string;
  isLive: boolean;
  viewerCount: number;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  streamKey: string;
  username: string;
  message: string;
  timestamp: number;
}

export interface TipRecord {
  id: string;
  streamKey: string;
  username: string;
  amount: string;
  message: string;
  txHash: string;
  timestamp: number;
}

// --- Row shapes (internal) ---

interface AgentRow {
  id: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  streamKey: string;
  apiKey: string;
  shieldedAddress: string;
  title: string;
  category: string;
  isLive: number;
  viewerCount: number;
  createdAt: number;
}

interface ChatRow {
  id: number;
  streamKey: string;
  username: string;
  message: string;
  timestamp: number;
}

interface TipRow {
  id: number;
  streamKey: string;
  username: string;
  amount: string;
  message: string;
  txHash: string;
  timestamp: number;
}

function rowToAgent(row: AgentRow): AgentRecord {
  return {
    name: row.displayName,
    description: row.bio,
    apiKey: row.apiKey,
    streamKey: row.streamKey,
    shieldedAddress: row.shieldedAddress,
    avatarUrl: row.avatarUrl,
    title: row.title,
    category: row.category,
    isLive: row.isLive === 1,
    viewerCount: row.viewerCount,
    createdAt: row.createdAt,
  };
}

function rowToChat(row: ChatRow): ChatMessage {
  return {
    id: String(row.id),
    streamKey: row.streamKey,
    username: row.username,
    message: row.message,
    timestamp: row.timestamp,
  };
}

function rowToTip(row: TipRow): TipRecord {
  return {
    id: String(row.id),
    streamKey: row.streamKey,
    username: row.username,
    amount: row.amount,
    message: row.message,
    txHash: row.txHash,
    timestamp: row.timestamp,
  };
}

// --- Constants ---

const CHAT_HISTORY_MAX = 200;

// --- Prepared statements ---

const insertAgent = db.prepare<
  [
    string, // id
    string, // displayName
    string, // bio
    string, // avatarUrl
    string, // streamKey
    string, // apiKey
    string, // shieldedAddress
    string, // title
    string, // category
    number, // isLive
    number, // viewerCount
    number, // createdAt
  ]
>(`
  INSERT INTO agents
    (id, displayName, bio, avatarUrl, streamKey, apiKey,
     shieldedAddress, title, category, isLive, viewerCount, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAgentIgnore = db.prepare<
  [
    string, string, string, string, string, string,
    string, string, string, number, number, number,
  ]
>(`
  INSERT OR IGNORE INTO agents
    (id, displayName, bio, avatarUrl, streamKey, apiKey,
     shieldedAddress, title, category, isLive, viewerCount, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectAgentById        = db.prepare<[string]>(`SELECT * FROM agents WHERE id = ?`);
const selectAgentByApiKey    = db.prepare<[string]>(`SELECT * FROM agents WHERE apiKey = ?`);
const selectAgentByStreamKey = db.prepare<[string]>(`SELECT * FROM agents WHERE streamKey = ?`);
const selectAllAgents        = db.prepare(`SELECT * FROM agents ORDER BY createdAt ASC`);
const selectLiveAgents       = db.prepare(`SELECT * FROM agents WHERE isLive = 1 ORDER BY viewerCount DESC`);
const selectSearchAgents     = db.prepare<[string, string, string, string]>(`
  SELECT * FROM agents
  WHERE LOWER(displayName) LIKE ?
     OR LOWER(title)       LIKE ?
     OR LOWER(category)    LIKE ?
     OR LOWER(bio)         LIKE ?
`);

const updateAgentFields = db.prepare<[string, string, string, string]>(`
  UPDATE agents SET bio = ?, shieldedAddress = ?, avatarUrl = ? WHERE apiKey = ?
`);

const updateStreamInfoStmt = db.prepare<[string, string, string]>(`
  UPDATE agents SET title = ?, category = ? WHERE streamKey = ?
`);

const setLiveOnStmt = db.prepare<[string]>(`
  UPDATE agents SET isLive = 1 WHERE streamKey = ?
`);
const setLiveOffStmt = db.prepare<[string]>(`
  UPDATE agents SET isLive = 0, viewerCount = 0 WHERE streamKey = ?
`);

const updateViewerCountStmt = db.prepare<[number, string]>(`
  UPDATE agents SET viewerCount = ? WHERE streamKey = ?
`);

const insertFollow = db.prepare<[string, string]>(`
  INSERT OR IGNORE INTO follows (followerId, followeeId) VALUES (?, ?)
`);
const deleteFollow = db.prepare<[string, string]>(`
  DELETE FROM follows WHERE followerId = ? AND followeeId = ?
`);
const selectFollowers = db.prepare<[string]>(`
  SELECT followerId FROM follows WHERE followeeId = ?
`);
const selectFollowing = db.prepare<[string]>(`
  SELECT followeeId FROM follows WHERE followerId = ?
`);
const selectIsFollowing = db.prepare<[string, string]>(`
  SELECT 1 AS ok FROM follows WHERE followerId = ? AND followeeId = ?
`);

const insertChat = db.prepare<[string, string, string, number]>(`
  INSERT INTO chat_messages (streamKey, username, message, timestamp)
  VALUES (?, ?, ?, ?)
`);
const selectChatHistory = db.prepare<[string, number]>(`
  SELECT * FROM (
    SELECT * FROM chat_messages
    WHERE streamKey = ?
    ORDER BY timestamp DESC
    LIMIT ?
  ) ORDER BY timestamp ASC
`);

const insertTip = db.prepare<[string, string, string, string, string, number]>(`
  INSERT INTO tips (streamKey, username, amount, message, txHash, timestamp)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const selectTipHistory = db.prepare<[string, number]>(`
  SELECT * FROM (
    SELECT * FROM tips
    WHERE streamKey = ?
    ORDER BY timestamp DESC
    LIMIT ?
  ) ORDER BY timestamp ASC
`);

// --- Helpers ---

// 32 bytes = 256 bits of entropy (hex-encoded to 64 chars). The "screams_"
// prefix is cosmetic and not counted toward entropy. Upgraded from 24 bytes
// during auth hardening — existing seeded keys with the old padding shape
// remain valid because the token is an opaque string.
function generateToken(): string {
  return 'screams_' + randomBytes(32).toString('hex');
}

function generateStreamKey(): string {
  return randomBytes(16).toString('hex');
}

// --- Agent CRUD ---

export function registerAgent(name: string, description: string): AgentRecord {
  const id = name.toLowerCase();
  if (selectAgentById.get(id)) {
    throw new Error('Name already taken');
  }

  const apiKey = generateToken();
  const streamKey = generateStreamKey();
  const createdAt = Date.now();

  insertAgent.run(
    id,
    name,
    description,
    '',
    streamKey,
    apiKey,
    '',
    `${name}'s stream`,
    'Just Chatting',
    0,
    0,
    createdAt,
  );

  console.log(`[store] registered agent "${name}" key=${apiKey.slice(0, 12)}…`);
  return rowToAgent(selectAgentById.get(id) as AgentRow);
}

export function getAgentByKey(apiKey: string): AgentRecord | undefined {
  const row = selectAgentByApiKey.get(apiKey) as AgentRow | undefined;
  return row ? rowToAgent(row) : undefined;
}

export function getAgentByName(name: string): AgentRecord | undefined {
  const row = selectAgentById.get(name.toLowerCase()) as AgentRow | undefined;
  return row ? rowToAgent(row) : undefined;
}

export function getAgentByStreamKey(streamKey: string): AgentRecord | undefined {
  const row = selectAgentByStreamKey.get(streamKey) as AgentRow | undefined;
  return row ? rowToAgent(row) : undefined;
}

export function updateAgent(
  apiKey: string,
  updates: Partial<Pick<AgentRecord, 'description' | 'shieldedAddress' | 'avatarUrl'>>,
): AgentRecord | undefined {
  const current = selectAgentByApiKey.get(apiKey) as AgentRow | undefined;
  if (!current) return undefined;

  updateAgentFields.run(
    updates.description ?? current.bio,
    updates.shieldedAddress ?? current.shieldedAddress,
    updates.avatarUrl ?? current.avatarUrl,
    apiKey,
  );

  return rowToAgent(selectAgentByApiKey.get(apiKey) as AgentRow);
}

// --- Stream Info ---

export function updateStreamInfo(streamKey: string, title?: string, category?: string): void {
  const current = selectAgentByStreamKey.get(streamKey) as AgentRow | undefined;
  if (!current) return;

  updateStreamInfoStmt.run(
    title ?? current.title,
    category ?? current.category,
    streamKey,
  );
}

export function setAgentLive(streamKey: string, isLive: boolean): void {
  if (isLive) {
    setLiveOnStmt.run(streamKey);
  } else {
    setLiveOffStmt.run(streamKey);
  }
}

export function updateViewerCount(streamKey: string, count: number): void {
  updateViewerCountStmt.run(count, streamKey);
}

// --- Browse ---

export function getAllAgents(): AgentRecord[] {
  return (selectAllAgents.all() as AgentRow[]).map(rowToAgent);
}

export function getLiveAgents(): AgentRecord[] {
  return (selectLiveAgents.all() as AgentRow[]).map(rowToAgent);
}

export function searchAgents(query: string): AgentRecord[] {
  const pattern = `%${query.toLowerCase()}%`;
  return (
    selectSearchAgents.all(pattern, pattern, pattern, pattern) as AgentRow[]
  ).map(rowToAgent);
}

// --- Follows ---

export function followAgent(followerName: string, targetName: string): boolean {
  const target = selectAgentById.get(targetName.toLowerCase()) as AgentRow | undefined;
  if (!target) return false;
  insertFollow.run(followerName.toLowerCase(), targetName.toLowerCase());
  return true;
}

export function unfollowAgent(followerName: string, targetName: string): boolean {
  deleteFollow.run(followerName.toLowerCase(), targetName.toLowerCase());
  return true;
}

export function getFollowers(name: string): string[] {
  const rows = selectFollowers.all(name.toLowerCase()) as Array<{ followerId: string }>;
  return rows.map((r) => r.followerId);
}

export function getFollowing(name: string): string[] {
  const rows = selectFollowing.all(name.toLowerCase()) as Array<{ followeeId: string }>;
  return rows.map((r) => r.followeeId);
}

export function isFollowing(followerName: string, targetName: string): boolean {
  return (
    selectIsFollowing.get(followerName.toLowerCase(), targetName.toLowerCase()) !== undefined
  );
}

// --- Chat History ---

export function addChatMessage(streamKey: string, username: string, message: string): ChatMessage {
  const timestamp = Date.now();
  const result = insertChat.run(streamKey, username, message, timestamp);
  return {
    id: String(result.lastInsertRowid),
    streamKey,
    username,
    message,
    timestamp,
  };
}

// Caps at 200 messages per stream key (per spec). Callers may request fewer
// via `limit` but can never exceed the hard ceiling. Rows are returned in
// ascending timestamp order.
export function getChatHistory(streamKey: string, limit: number = 50): ChatMessage[] {
  const effective = Math.min(limit, CHAT_HISTORY_MAX);
  const rows = selectChatHistory.all(streamKey, effective) as ChatRow[];
  return rows.map(rowToChat);
}

// --- Tip History ---

export function addTipRecord(
  streamKey: string,
  username: string,
  amount: string,
  message: string,
  txHash: string = '',
): TipRecord {
  const timestamp = Date.now();
  const result = insertTip.run(streamKey, username, amount, message, txHash, timestamp);
  return {
    id: String(result.lastInsertRowid),
    streamKey,
    username,
    amount,
    message,
    txHash,
    timestamp,
  };
}

export function getTipHistory(streamKey: string, limit: number = 25): TipRecord[] {
  const rows = selectTipHistory.all(streamKey, limit) as TipRow[];
  return rows.map(rowToTip);
}

// --- Seed Agent Lump Profile ---
// Pre-create the Agent Lump streamer with a known stream key for testing.
// INSERT OR IGNORE so repeated boots are idempotent — the stored row wins
// if the DB already has an AgentLump entry.

const AGENT_LUMP_STREAM_KEY = 'agentlump2026';

function seedAgentLump(): void {
  const apiKey = 'screams_' + 'agentlump'.padEnd(48, '0');

  const result = insertAgentIgnore.run(
    'agentlump',
    'AgentLump',
    'The original AI streamer on Screams',
    '',
    AGENT_LUMP_STREAM_KEY,
    apiKey,
    '',
    "Agent Lump's Stream",
    'Just Chatting',
    0,
    0,
    Date.now(),
  );

  if (result.changes > 0) {
    console.log('[store] Seeded Agent Lump profile');
    console.log('[store]   Stream Key:', AGENT_LUMP_STREAM_KEY);
    console.log('[store]   API Key:', apiKey);
  } else {
    console.log('[store] Agent Lump profile already in DB (skipped seeding)');
  }
}

seedAgentLump();
