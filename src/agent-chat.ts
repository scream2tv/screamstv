// Agent Lump auto-chat: sends educational Midnight network messages
// into the stream chat at random intervals (15-30 min) when live.

import { getAgentByStreamKey, addChatMessage } from './store.js';
import { broadcastToStream } from './ws/handler.js';

const AGENT_LUMP_STREAM_KEY = 'agentlump2026';
const AGENT_LUMP_USERNAME = 'AgentLump';
const MIN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const MESSAGES = [
  "Midnight is a privacy-first blockchain built on zero-knowledge proofs. Your data stays yours.",
  "Ever wonder how you can prove something without revealing it? That's ZK tech — the core of Midnight.",
  "On Midnight, smart contracts can handle private data without exposing it on-chain. Game changer for real-world apps.",
  "Midnight uses a dual-asset model: NIGHT for governance and DUST for gas fees. Clean separation of concerns.",
  "What makes Midnight different from other L1s? It's designed from the ground up for data protection, not just financial privacy.",
  "ZK proofs on Midnight let you verify compliance without revealing personal information. Think KYC without the data leak.",
  "Midnight's shielded addresses let you receive payments without your balance being public. Privacy should be the default.",
  "The Compact compiler on Midnight lets you write smart contracts in TypeScript. No new language to learn.",
  "Midnight smart contracts have two parts: public on-chain state and private off-chain computation. Best of both worlds.",
  "Midnight is built by Input Output, the same team behind Cardano. Years of peer-reviewed research backing it up.",
  "Token shielding on Midnight lets you move assets between public and private states. You control your visibility.",
  "Midnight's approach to regulatory compliance is unique — you can prove you meet requirements without exposing underlying data.",
  "Building a DApp on Midnight? You write TypeScript, the Compact compiler handles the ZK circuit generation automatically.",
  "Midnight isn't just about financial privacy. Think private voting, confidential supply chains, healthcare data — any sensitive info.",
  "The Midnight testnet is live. Developers can start building privacy-preserving DApps right now.",
  "On most blockchains, everything is public by default. Midnight flips that — privacy by default, selective disclosure when needed.",
  "DUST tokens on Midnight are used for gas fees, keeping transaction costs separate from governance. Simple and clean.",
  "Midnight uses a UTXO-based model enhanced with ZK proofs. If you know Cardano's eUTXO, you'll feel right at home.",
  "The vision for Midnight: a world where you can interact on-chain without sacrificing your personal data. That's the future.",
  "Zero-knowledge proofs sound complex, but on Midnight the complexity is hidden. Developers just write TypeScript, the protocol does the rest.",
  "Midnight's data protection isn't just encryption — it's mathematical proof that data was handled correctly without ever seeing it.",
  "Why does blockchain privacy matter? Because public ledgers plus real-world identity equals surveillance. Midnight breaks that link.",
  "Midnight is designed to be interoperable. It's not trying to replace other chains — it's adding the privacy layer they're missing.",
  "Smart contracts on Midnight can selectively reveal information. Show your age is over 18 without showing your birthday.",
  "The Midnight ecosystem is growing. From DeFi to identity to governance — privacy unlocks use cases that public chains can't touch.",
];

let shuffled: string[] = [];
let index = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function shuffle(): void {
  shuffled = [...MESSAGES].sort(() => Math.random() - 0.5);
  index = 0;
}

function nextMessage(): string {
  if (index >= shuffled.length) shuffle();
  return shuffled[index++];
}

function randomInterval(): number {
  return MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
}

function tick(): void {
  const agent = getAgentByStreamKey(AGENT_LUMP_STREAM_KEY);
  if (agent?.isLive) {
    const text = nextMessage();
    addChatMessage(AGENT_LUMP_STREAM_KEY, AGENT_LUMP_USERNAME, text);
    broadcastToStream(AGENT_LUMP_STREAM_KEY, {
      type: 'chat',
      username: AGENT_LUMP_USERNAME,
      message: text,
      timestamp: Date.now(),
    });
    console.log(`[agent-chat] sent: "${text.slice(0, 60)}..."`);
  }
  timer = setTimeout(tick, randomInterval());
}

export function startAgentChat(): void {
  shuffle();
  timer = setTimeout(tick, randomInterval());
  console.log('[agent-chat] Agent Lump auto-chat started');
}
