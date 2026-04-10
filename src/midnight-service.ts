import {
  initWallet,
  stopWallet,
  transferShielded,
  type InitializedWallet,
  type TransferResult,
} from 'midnight-agent';

const walletCache = new Map<string, { wallet: InitializedWallet; lastUsed: number }>();

const CACHE_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of walletCache) {
    if (now - entry.lastUsed > CACHE_TTL_MS) {
      console.log(`[midnight] evicting cached wallet ${key.slice(0, 8)}…`);
      stopWallet(entry.wallet).catch(() => {});
      walletCache.delete(key);
    }
  }
}, 60_000);

export async function getOrInitWallet(seedHex: string): Promise<InitializedWallet> {
  const cached = walletCache.get(seedHex);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.wallet;
  }

  console.log(`[midnight] initializing wallet for seed ${seedHex.slice(0, 8)}…`);
  const prevSeed = process.env.MIDNIGHT_WALLET_SEED;
  process.env.MIDNIGHT_WALLET_SEED = seedHex;

  try {
    const wallet = await initWallet(undefined, { waitForSync: true, syncTimeoutMs: 120_000 });
    walletCache.set(seedHex, { wallet, lastUsed: Date.now() });
    return wallet;
  } finally {
    if (prevSeed !== undefined) {
      process.env.MIDNIGHT_WALLET_SEED = prevSeed;
    } else {
      delete process.env.MIDNIGHT_WALLET_SEED;
    }
  }
}

export interface TipParams {
  viewerSeedHex: string;
  streamerShieldedAddress: string;
  amount: bigint;
}

export async function sendShieldedTip(params: TipParams): Promise<TransferResult> {
  const wallet = await getOrInitWallet(params.viewerSeedHex);

  const result = await transferShielded(wallet, [
    {
      amount: params.amount,
      receiverAddress: params.streamerShieldedAddress,
    },
  ]);

  return result;
}
