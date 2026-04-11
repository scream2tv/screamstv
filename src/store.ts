import { randomBytes } from 'crypto';

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

// --- Storage ---

const agentsByKey = new Map<string, AgentRecord>();
const agentsByName = new Map<string, AgentRecord>();
const agentsByStreamKey = new Map<string, AgentRecord>();

const follows = new Map<string, Set<string>>();
const followers = new Map<string, Set<string>>();

const chatHistory = new Map<string, ChatMessage[]>();
const tipHistory = new Map<string, TipRecord[]>();

const MAX_CHAT_HISTORY = 200;
const MAX_TIP_HISTORY = 200;

// --- Helpers ---

function generateToken(): string {
  return 'lump_' + randomBytes(24).toString('hex');
}

function generateStreamKey(): string {
  return randomBytes(16).toString('hex');
}

function generateId(): string {
  return randomBytes(8).toString('hex');
}

// --- Agent CRUD ---

export function registerAgent(name: string, description: string): AgentRecord {
  if (agentsByName.has(name.toLowerCase())) {
    throw new Error('Name already taken');
  }

  const apiKey = generateToken();
  const streamKey = generateStreamKey();

  const record: AgentRecord = {
    name,
    description,
    apiKey,
    streamKey,
    shieldedAddress: '',
    avatarUrl: '',
    title: `${name}'s stream`,
    category: 'Just Chatting',
    isLive: false,
    viewerCount: 0,
    createdAt: Date.now(),
  };

  agentsByKey.set(apiKey, record);
  agentsByName.set(name.toLowerCase(), record);
  agentsByStreamKey.set(streamKey, record);

  console.log(`[store] registered agent "${name}" key=${apiKey.slice(0, 12)}…`);
  return record;
}

export function getAgentByKey(apiKey: string): AgentRecord | undefined {
  return agentsByKey.get(apiKey);
}

export function getAgentByName(name: string): AgentRecord | undefined {
  return agentsByName.get(name.toLowerCase());
}

export function getAgentByStreamKey(streamKey: string): AgentRecord | undefined {
  return agentsByStreamKey.get(streamKey);
}

export function updateAgent(
  apiKey: string,
  updates: Partial<Pick<AgentRecord, 'description' | 'shieldedAddress' | 'avatarUrl'>>,
): AgentRecord | undefined {
  const agent = agentsByKey.get(apiKey);
  if (!agent) return undefined;

  if (updates.description !== undefined) agent.description = updates.description;
  if (updates.shieldedAddress !== undefined) agent.shieldedAddress = updates.shieldedAddress;
  if (updates.avatarUrl !== undefined) agent.avatarUrl = updates.avatarUrl;

  return agent;
}

// --- Stream Info ---

export function updateStreamInfo(streamKey: string, title?: string, category?: string): void {
  const agent = agentsByStreamKey.get(streamKey);
  if (!agent) return;
  if (title !== undefined) agent.title = title;
  if (category !== undefined) agent.category = category;
}

export function setAgentLive(streamKey: string, isLive: boolean): void {
  const agent = agentsByStreamKey.get(streamKey);
  if (agent) {
    agent.isLive = isLive;
    if (!isLive) agent.viewerCount = 0;
  }
}

export function updateViewerCount(streamKey: string, count: number): void {
  const agent = agentsByStreamKey.get(streamKey);
  if (agent) agent.viewerCount = count;
}

// --- Browse ---

export function getAllAgents(): AgentRecord[] {
  return Array.from(agentsByKey.values());
}

export function getLiveAgents(): AgentRecord[] {
  return Array.from(agentsByKey.values()).filter((a) => a.isLive);
}

export function searchAgents(query: string): AgentRecord[] {
  const q = query.toLowerCase();
  return Array.from(agentsByKey.values()).filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.title.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q),
  );
}

// --- Follows ---

export function followAgent(followerName: string, targetName: string): boolean {
  const target = agentsByName.get(targetName.toLowerCase());
  if (!target) return false;

  const normalFollower = followerName.toLowerCase();
  const normalTarget = targetName.toLowerCase();

  if (!follows.has(normalFollower)) follows.set(normalFollower, new Set());
  if (!followers.has(normalTarget)) followers.set(normalTarget, new Set());

  follows.get(normalFollower)!.add(normalTarget);
  followers.get(normalTarget)!.add(normalFollower);
  return true;
}

export function unfollowAgent(followerName: string, targetName: string): boolean {
  const normalFollower = followerName.toLowerCase();
  const normalTarget = targetName.toLowerCase();

  follows.get(normalFollower)?.delete(normalTarget);
  followers.get(normalTarget)?.delete(normalFollower);
  return true;
}

export function getFollowers(name: string): string[] {
  return Array.from(followers.get(name.toLowerCase()) ?? []);
}

export function getFollowing(name: string): string[] {
  return Array.from(follows.get(name.toLowerCase()) ?? []);
}

export function isFollowing(followerName: string, targetName: string): boolean {
  return follows.get(followerName.toLowerCase())?.has(targetName.toLowerCase()) ?? false;
}

// --- Chat History ---

export function addChatMessage(streamKey: string, username: string, message: string): ChatMessage {
  if (!chatHistory.has(streamKey)) chatHistory.set(streamKey, []);
  const history = chatHistory.get(streamKey)!;

  const record: ChatMessage = {
    id: generateId(),
    streamKey,
    username,
    message,
    timestamp: Date.now(),
  };

  history.push(record);
  if (history.length > MAX_CHAT_HISTORY) history.shift();

  return record;
}

export function getChatHistory(streamKey: string, limit: number = 50): ChatMessage[] {
  const history = chatHistory.get(streamKey) ?? [];
  return history.slice(-limit);
}

// --- Tip History ---

export function addTipRecord(
  streamKey: string,
  username: string,
  amount: string,
  message: string,
  txHash: string = '',
): TipRecord {
  if (!tipHistory.has(streamKey)) tipHistory.set(streamKey, []);
  const history = tipHistory.get(streamKey)!;

  const record: TipRecord = {
    id: generateId(),
    streamKey,
    username,
    amount,
    message,
    txHash,
    timestamp: Date.now(),
  };

  history.push(record);
  if (history.length > MAX_TIP_HISTORY) history.shift();

  return record;
}

export function getTipHistory(streamKey: string, limit: number = 25): TipRecord[] {
  const history = tipHistory.get(streamKey) ?? [];
  return history.slice(-limit);
}

// --- Seed Agent Lump Profile ---
// Pre-create the Agent Lump streamer with a known stream key for testing

const AGENT_LUMP_STREAM_KEY = 'agentlump2026';

function seedAgentLump(): void {
  if (agentsByName.has('agentlump')) return;

  const apiKey = 'lump_' + 'agentlump'.padEnd(48, '0');
  const record: AgentRecord = {
    name: 'AgentLump',
    description: 'The original AI streamer on Screams',
    apiKey,
    streamKey: AGENT_LUMP_STREAM_KEY,
    shieldedAddress: '',
    avatarUrl: '',
    title: "Agent Lump's Stream",
    category: 'Just Chatting',
    isLive: false,
    viewerCount: 0,
    createdAt: Date.now(),
  };

  agentsByKey.set(apiKey, record);
  agentsByName.set('agentlump', record);
  agentsByStreamKey.set(AGENT_LUMP_STREAM_KEY, record);

  console.log('[store] Seeded Agent Lump profile');
  console.log('[store]   Stream Key:', AGENT_LUMP_STREAM_KEY);
  console.log('[store]   API Key:', apiKey);
}

seedAgentLump();
