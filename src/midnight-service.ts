// Midnight wallet integration — stubbed out until tipping is enabled.
// Requires the `midnight-agent` package which will be added when
// the tip feature moves from "Coming Soon" to live.

export interface TipParams {
  viewerSeedHex: string;
  streamerShieldedAddress: string;
  amount: bigint;
}

export async function getOrInitWallet(_seedHex: string): Promise<unknown> {
  throw new Error('Midnight wallet integration is not yet enabled');
}

export async function sendShieldedTip(_params: TipParams): Promise<unknown> {
  throw new Error('Midnight wallet integration is not yet enabled');
}
