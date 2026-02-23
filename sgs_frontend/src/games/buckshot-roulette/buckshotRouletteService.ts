import { Client as BuckshotRouletteClient, type Game, type SeedCommitment } from './bindings';
import { NETWORK_PASSPHRASE, RPC_URL, DEFAULT_METHOD_OPTIONS, DEFAULT_AUTH_TTL_MINUTES } from '@/utils/constants';
import { contract, xdr, Address } from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
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

  async getSeedCommitment(sessionId: number, player: string): Promise<SeedCommitment | null> {
    try {
      const tx = await this.baseClient.get_seed_commitment({ session_id: sessionId, player });
      // For Option<T> return types, tx.result is T | undefined after auto-simulation
      // Try accessing the result directly first
      try {
        const res = tx.result;
        if (res !== undefined && res !== null) {
          return res as SeedCommitment;
        }
        return null;
      } catch {
        // If result access fails, try simulate
        try {
          const simulated = await tx.simulate();
          const res = simulated.result;
          if (res !== undefined && res !== null) {
            return res as SeedCommitment;
          }
        } catch {
          // Simulation failed - commitment doesn't exist
        }
        return null;
      }
    } catch (err) {
      // Construction/auto-simulation failed entirely — commitment likely doesn't exist
      console.log('[getSeedCommitment] Error:', err);
      return null;
    }
  }

  /**
   * Check if a player's commitment exists in contract storage.
   * Uses direct RPC getLedgerEntries to avoid SDK Option<T> deserialization issues.
   * @param sessionId - the game session
   * @param checkPlayer1 - true to check P1's commitment, false for P2's
   */
  async checkCommitmentExists(sessionId: number, checkPlayer1: boolean): Promise<boolean> {
    try {
      const server = new SorobanRpc.Server(RPC_URL);

      // Build the DataKey enum variant as ScVal
      // P1Commitment(u32) or P2Commitment(u32)
      const sessionVal = xdr.ScVal.scvU32(sessionId);
      const commitmentKey = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol(checkPlayer1 ? 'P1Commitment' : 'P2Commitment'),
        sessionVal,
      ]);

      const contractAddress = new Address(this.contractId);
      const ledgerKey = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: contractAddress.toScAddress(),
          key: commitmentKey,
          durability: xdr.ContractDataDurability.temporary(),
        })
      );

      const entries = await server.getLedgerEntries(ledgerKey);
      return entries.entries != null && entries.entries.length > 0;
    } catch (err) {
      console.log('[checkCommitmentExists] Error:', err);
      return false;
    }
  }

  /**
   * Check if the CombinedSeed exists (both players revealed).
   * Fast RPC check — avoids expensive finalize simulation when not ready.
   */
  async checkCombinedSeedExists(sessionId: number): Promise<boolean> {
    try {
      const server = new SorobanRpc.Server(RPC_URL);
      const sessionVal = xdr.ScVal.scvU32(sessionId);
      const seedKey = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('CombinedSeed'),
        sessionVal,
      ]);

      const contractAddress = new Address(this.contractId);
      const ledgerKey = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: contractAddress.toScAddress(),
          key: seedKey,
          durability: xdr.ContractDataDurability.temporary(),
        })
      );

      const entries = await server.getLedgerEntries(ledgerKey);
      return entries.entries != null && entries.entries.length > 0;
    } catch (err) {
      console.log('[checkCombinedSeedExists] Error:', err);
      return false;
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

    // Must use force: true because the SDK may misclassify Result<void> as a read call
    const simulated = await tx.simulate();
    console.log('[revealSeed] Simulated, sending with force...');
    await simulated.signAndSend({ force: true });
    console.log('[revealSeed] Transaction sent successfully');
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

    const simulated = await tx.simulate();
    console.log('[finalizeGameStart] Simulated, sending with force...');
    await simulated.signAndSend({ force: true });
    console.log('[finalizeGameStart] Transaction sent successfully');
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

    const simulated = await tx.simulate();
    const sent = await simulated.signAndSend({ force: true });
    const result = sent.result;
    // Unwrap Result<boolean> if needed
    if (result && typeof result === 'object' && 'isOk' in result) {
      return (result as any).unwrap() as boolean;
    }
    return result as boolean;
  }

  async shootOpponent(sessionId: number, player: string, signer: Signer): Promise<boolean> {
    const client = this.createSigningClient(player, signer);
    const tx = await client.shoot_opponent({ session_id: sessionId, player }, DEFAULT_METHOD_OPTIONS);

    const simulated = await tx.simulate();
    const sent = await simulated.signAndSend({ force: true });
    const result = sent.result;
    // Unwrap Result<boolean> if needed
    if (result && typeof result === 'object' && 'isOk' in result) {
      return (result as any).unwrap() as boolean;
    }
    return result as boolean;
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
  // MUST use keccak256 to match the contract's env.crypto().keccak256()
  const { keccak_256 } = await import('@noble/hashes/sha3');
  return keccak_256(seed);
}
