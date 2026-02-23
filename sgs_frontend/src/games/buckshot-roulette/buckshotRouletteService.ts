import { Client as BuckshotRouletteClient, type Game } from './bindings';
import { NETWORK_PASSPHRASE, RPC_URL, DEFAULT_METHOD_OPTIONS, DEFAULT_AUTH_TTL_MINUTES } from '@/utils/constants';
import { contract } from '@stellar/stellar-sdk';
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

  async startGame(sessionId: number, caller: string, signer: Signer): Promise<void> {
    const client = this.createSigningClient(caller, signer);
    const tx = await client.start_game({ session_id: sessionId }, DEFAULT_METHOD_OPTIONS);

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

  async getShellCount(sessionId: number): Promise<number> {
    const tx = await this.baseClient.get_shell_count({ session_id: sessionId });
    const result = await tx.simulate();
    if (result.result.isOk()) {
      return result.result.unwrap() as number;
    }
    return 0;
  }
}

export const buckshotRouletteService = new BuckshotRouletteService(
  'CBUCOZAI3Z43CAGB4EX2XAMSVM3IMLIPKYABP7PPRTCV4EELVNHTGQT5'
);
