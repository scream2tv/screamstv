// Screams — SQLite persistence layer
//
// Opens (or creates) data/screams.db on first import, enables WAL, and runs
// inline "CREATE TABLE IF NOT EXISTS" migrations for agents, follows,
// chat_messages, and tips. Consumed exclusively by src/store.ts — every
// other file should keep importing from ../store.js.
//
// Schema notes (deliberate deviations from the original spec, to preserve
// the existing AgentRecord / ChatMessage / TipRecord TypeScript interfaces
// that the rest of the codebase depends on):
//   - agents.id is the lowercase lookup name (no separate lookupName column)
//   - agents adds shieldedAddress + title, required by AgentRecord
//   - createdAt / timestamp columns are INTEGER (unix ms), not TEXT, so
//     numeric TS types flow through without a conversion round-trip
//   - chat_messages.username is a single string (viewers may not be agents)
//   - tips.amount is TEXT (TipRecord.amount is string, keeps big-number
//     precision) and indexed by streamKey, not toAgentId

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = resolve(__dirname, '..', 'data');
const DB_PATH = join(DATA_DIR, 'screams.db');

mkdirSync(DATA_DIR, { recursive: true });

export const db: DatabaseType = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS agents (
    id              TEXT PRIMARY KEY,
    displayName     TEXT NOT NULL,
    bio             TEXT NOT NULL DEFAULT '',
    avatarUrl       TEXT NOT NULL DEFAULT '',
    streamKey       TEXT NOT NULL UNIQUE,
    apiKey          TEXT NOT NULL UNIQUE,
    shieldedAddress TEXT NOT NULL DEFAULT '',
    title           TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'Just Chatting',
    isLive          INTEGER NOT NULL DEFAULT 0,
    viewerCount     INTEGER NOT NULL DEFAULT 0,
    createdAt       INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS agents_streamKey_idx ON agents(streamKey)`,
  `CREATE INDEX IF NOT EXISTS agents_apiKey_idx    ON agents(apiKey)`,
  `CREATE INDEX IF NOT EXISTS agents_isLive_idx    ON agents(isLive)`,
  `CREATE TABLE IF NOT EXISTS follows (
    followerId TEXT NOT NULL,
    followeeId TEXT NOT NULL,
    PRIMARY KEY (followerId, followeeId)
  )`,
  `CREATE INDEX IF NOT EXISTS follows_followeeId_idx ON follows(followeeId)`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    streamKey  TEXT NOT NULL,
    username   TEXT NOT NULL,
    message    TEXT NOT NULL,
    timestamp  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS chat_messages_streamKey_idx ON chat_messages(streamKey, timestamp)`,
  `CREATE TABLE IF NOT EXISTS tips (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    streamKey  TEXT NOT NULL,
    username   TEXT NOT NULL,
    amount     TEXT NOT NULL,
    message    TEXT NOT NULL DEFAULT '',
    txHash     TEXT NOT NULL DEFAULT '',
    timestamp  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS tips_streamKey_idx ON tips(streamKey)`,
];

for (const statement of SCHEMA_SQL) {
  db.exec(statement);
}

console.log(`[db] SQLite ready at ${DB_PATH}`);
