import { Client as BuckshotRouletteClient, type Game } from './bindings';
import { NETWORK_PASSPHRASE, RPC_URL, DEFAULT_METHOD_OPTIONS, DEFAULT_AUTH_TTL_MINUTES } from '@/utils/constants';
import { contract } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';
import { calculateValidUntilLedger } from '@/utils/ledgerUtils';

type ClientOptions = contract.ClientOptions;
type Signer = Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>;

export class BuckshotRouletteService {
  private baseClient: BuckshotRouletteClient;
  private contractId: string;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.baseClient = new BuckshotRouletteClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
    });
  }

  private createSigningClient(publicKey: string, signer: Signer): BuckshotRouletteClient {
    return new BuckshotRouletteClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey,
      ...signer,
    });
  }

  async getGame(sessionId: number): Promise<Game | null> {
    try {
      const tx = await this.baseClient.get_game({ session_id: sessionId });
      const result = await tx.simulate();
      if (result.result.isOk()) {
        return result.result.unwrap();
      }
      return null;
    } catch (err) {
      console.log('[getGame] Error:', err);
      return null;
    }
  }

  // ZK Commit-Reveal Functions
  
  async commitSeed(
    sessionId: number,
    player: string,
    commitment: Uint8Array,
    signer: Signer
  ): Promise<void> {
    const client = this.createSigningClient(player, signer);
    const tx = await client.commit_seed({
      session_id: sessionId,
      player,
      commitment: Buffer.from(commitment),
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);
  }

  async revealSeed(
    sessionId: number,
    player: string,
    seed: Uint8Array,
    signer: Signer
  ): Promise<void> {
    const client = this.createSigningClient(player, signer);
    const tx = await client.reveal_seed({
      session_id: sessionId,
      player,
      seed: Buffer.from(seed),
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);
  }

  // Game Lifecycle Functions

  async createGame(
    sessionId: number,
    player1: string,
    player1Points: bigint,
    signer: Signer
  ): Promise<void> {
    const client = this.createSigningClient(player1, signer);
    const tx = await client.create_game({
      session_id: sessionId,
      player1,
      player1_points: player1Points,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);
  }

  async joinGame(
    sessionId: number,
    player2: string,
    player2Points: bigint,
    signer: Signer
  ): Promise<void> {
    const client = this.createSigningClient(player2, signer);
    const tx = await client.join_game({
      session_id: sessionId,
      player2,
      player2_points: player2Points,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);
  }

  async finalizeGameStart(sessionId: number, caller: string, signer: Signer): Promise<void> {
    const client = this.createSigningClient(caller, signer);
    const tx = await client.finalize_game_start({ session_id: sessionId }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);
  }

  async startRound(sessionId: number, caller: string, signer: Signer): Promise<void> {
    const client = this.createSigningClient(caller, signer);
    const tx = await client.start_round({ session_id: sessionId }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);
  }

  async shootSelf(sessionId: number, player: string, signer: Signer): Promise<boolean> {
    const client = this.createSigningClient(player, signer);
    const tx = await client.shoot_self({ session_id: sessionId, player }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);
    return sentTx.result as boolean;
  }

  async shootOpponent(sessionId: number, player: string, signer: Signer): Promise<boolean> {
    const client = this.createSigningClient(player, signer);
    const tx = await client.shoot_opponent({ session_id: sessionId, player }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);
    return sentTx.result as boolean;
  }
}

export const buckshotRouletteService = new BuckshotRouletteService(
  'CBB2W6PK2UBPKSXCXG2S2R3VOS4ISV5HLJVFKNDMOUG6KABPJJ5JCJGJ'
);

// Helper to generate random seed and commitment
export function generateZKSeed(): Uint8Array {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return seed;
}

export async function hashSeed(seed: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', seed.buffer as ArrayBuffer);
  return new Uint8Array(hashBuffer);
}
