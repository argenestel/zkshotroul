import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";

export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CCYH63LWOBBHRHWZ3YQOYNQMM6L42HIQCXJLZCEPZ73XEENXJOLIJVSU",
  }
} as const


export interface Game {
  blank_count: u32;
  current_shell_index: u32;
  live_count: u32;
  p1_health: u32;
  p2_health: u32;
  player1: string;
  player1_points: i128;
  player2: Option<string>;
  player2_points: i128;
  round: u32;
  shells_remaining: u32;
  status: GameStatus;
  turn: u32;
  winner: Option<string>;
}

export const Errors = {
  1: { message: "GameNotFound" },
  2: { message: "NotPlayer" },
  3: { message: "GameAlreadyEnded" },
  4: { message: "NotYourTurn" },
  5: { message: "NoShellsRemaining" },
  6: { message: "AlreadyCommitted" },
  7: { message: "BothPlayersNotCommitted" },
  8: { message: "CommitmentMismatch" },
  9: { message: "AlreadyRevealed" },
  10: { message: "SeedsNotRevealed" },
  11: { message: "WaitingForOpponentCommit" },
  12: { message: "WaitingForOpponentReveal" }
}

export type DataKey = { tag: "Game", values: readonly [u32] } | { tag: "GameHubAddress", values: void } | { tag: "Admin", values: void } | { tag: "P1Commitment", values: readonly [u32] } | { tag: "P2Commitment", values: readonly [u32] } | { tag: "CombinedSeed", values: readonly [u32] };

export enum ShellType {
  Blank = 0,
  Live = 1,
}

export type GameStatus = { tag: "WaitingForPlayer2", values: void } | { tag: "AwaitingSeeds", values: void } | { tag: "AwaitingReveal", values: void } | { tag: "InProgress", values: void } | { tag: "Ended", values: void };


export interface SeedCommitment {
  commitment: Buffer;
  revealed: boolean;
  seed: Option<Buffer>;
}

export interface Client {
  /**
   * Construct and simulate a get_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_hub: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_hub: ({ new_hub }: { new_hub: string }, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({ new_wasm_hash }: { new_wasm_hash: Buffer }, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game: ({ session_id }: { session_id: u32 }, options?: MethodOptions) => Promise<AssembledTransaction<Result<Game>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a join_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Player 2 joins the game
   */
  join_game: ({ session_id, player2, player2_points }: { session_id: u32, player2: string, player2_points: i128 }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({ new_admin }: { new_admin: string }, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a shoot_self transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  shoot_self: ({ session_id, player }: { session_id: u32, player: string }, options?: MethodOptions) => Promise<AssembledTransaction<Result<boolean>>>

  /**
   * Construct and simulate a commit_seed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Commit your secret seed (ZK step 1)
   * Player commits hash(secret) - the secret stays hidden
   */
  commit_seed: ({ session_id, player, commitment }: { session_id: u32, player: string, commitment: Buffer }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Player 1 creates a game lobby
   */
  create_game: ({ session_id, player1, player1_points }: { session_id: u32, player1: string, player1_points: i128 }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reveal_seed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reveal your secret seed (ZK step 2)
   * Player reveals the original seed - contract verifies it matches commitment
   */
  reveal_seed: ({ session_id, player, seed }: { session_id: u32, player: string, seed: Buffer }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a start_round transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Start a new round (generates shells from ZK seed)
   */
  start_round: ({ session_id }: { session_id: u32 }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a shoot_opponent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  shoot_opponent: ({ session_id, player }: { session_id: u32, player: string }, options?: MethodOptions) => Promise<AssembledTransaction<Result<boolean>>>

  /**
   * Construct and simulate a finalize_game_start transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Finalize game start after ZK reveal (anyone can call)
   */
  finalize_game_start: ({ session_id }: { session_id: u32 }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_seed_commitment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_seed_commitment: ({ session_id, player }: { session_id: u32, player: string }, options?: MethodOptions) => Promise<AssembledTransaction<Option<SeedCommitment>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Constructor/Initialization Args for the contract's `__constructor` method */
    { admin, game_hub }: { admin: string, game_hub: string },
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({ admin, game_hub }, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec(["AAAAAQAAAAAAAAAAAAAABEdhbWUAAAAOAAAAAAAAAAtibGFua19jb3VudAAAAAAEAAAAAAAAABNjdXJyZW50X3NoZWxsX2luZGV4AAAAAAQAAAAAAAAACmxpdmVfY291bnQAAAAAAAQAAAAAAAAACXAxX2hlYWx0aAAAAAAAAAQAAAAAAAAACXAyX2hlYWx0aAAAAAAAAAQAAAAAAAAAB3BsYXllcjEAAAAAEwAAAAAAAAAOcGxheWVyMV9wb2ludHMAAAAAAAsAAAAAAAAAB3BsYXllcjIAAAAD6AAAABMAAAAAAAAADnBsYXllcjJfcG9pbnRzAAAAAAALAAAAAAAAAAVyb3VuZAAAAAAAAAQAAAAAAAAAEHNoZWxsc19yZW1haW5pbmcAAAAEAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAKR2FtZVN0YXR1cwAAAAAAAAAAAAR0dXJuAAAABAAAAAAAAAAGd2lubmVyAAAAAAPoAAAAEw==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAADAAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAQAAAAAAAAAJTm90UGxheWVyAAAAAAAAAgAAAAAAAAAQR2FtZUFscmVhZHlFbmRlZAAAAAMAAAAAAAAAC05vdFlvdXJUdXJuAAAAAAQAAAAAAAAAEU5vU2hlbGxzUmVtYWluaW5nAAAAAAAABQAAAAAAAAAQQWxyZWFkeUNvbW1pdHRlZAAAAAYAAAAAAAAAF0JvdGhQbGF5ZXJzTm90Q29tbWl0dGVkAAAAAAcAAAAAAAAAEkNvbW1pdG1lbnRNaXNtYXRjaAAAAAAACAAAAAAAAAAPQWxyZWFkeVJldmVhbGVkAAAAAAkAAAAAAAAAEFNlZWRzTm90UmV2ZWFsZWQAAAAKAAAAAAAAABhXYWl0aW5nRm9yT3Bwb25lbnRDb21taXQAAAALAAAAAAAAABhXYWl0aW5nRm9yT3Bwb25lbnRSZXZlYWwAAAAM",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABgAAAAEAAAAAAAAABEdhbWUAAAABAAAABAAAAAAAAAAAAAAADkdhbWVIdWJBZGRyZXNzAAAAAAAAAAAAAAAAAAVBZG1pbgAAAAAAAAEAAAAAAAAADFAxQ29tbWl0bWVudAAAAAEAAAAEAAAAAQAAAAAAAAAMUDJDb21taXRtZW50AAAAAQAAAAQAAAABAAAAAAAAAAxDb21iaW5lZFNlZWQAAAABAAAABA==",
        "AAAAAwAAAAAAAAAAAAAACVNoZWxsVHlwZQAAAAAAAAIAAAAAAAAABUJsYW5rAAAAAAAAAAAAAAAAAAAETGl2ZQAAAAE=",
        "AAAAAgAAAAAAAAAAAAAACkdhbWVTdGF0dXMAAAAAAAUAAAAAAAAAAAAAABFXYWl0aW5nRm9yUGxheWVyMgAAAAAAAAAAAAAAAAAADUF3YWl0aW5nU2VlZHMAAAAAAAAAAAAAAAAAAA5Bd2FpdGluZ1JldmVhbAAAAAAAAAAAAAAAAAAKSW5Qcm9ncmVzcwAAAAAAAAAAAAAAAAAFRW5kZWQAAAA=",
        "AAAAAQAAAAAAAAAAAAAADlNlZWRDb21taXRtZW50AAAAAAADAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAAIcmV2ZWFsZWQAAAABAAAAAAAAAARzZWVkAAAD6AAAA+4AAAAg",
        "AAAAAAAAAAAAAAAHZ2V0X2h1YgAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAHc2V0X2h1YgAAAAABAAAAAAAAAAduZXdfaHViAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+kAAAfQAAAABEdhbWUAAAAD",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAABdQbGF5ZXIgMiBqb2lucyB0aGUgZ2FtZQAAAAAJam9pbl9nYW1lAAAAAAAAAwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAHcGxheWVyMgAAAAATAAAAAAAAAA5wbGF5ZXIyX3BvaW50cwAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAKc2hvb3Rfc2VsZgAAAAAAAgAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAGcGxheWVyAAAAAAATAAAAAQAAA+kAAAABAAAAAw==",
        "AAAAAAAAAFlDb21taXQgeW91ciBzZWNyZXQgc2VlZCAoWksgc3RlcCAxKQpQbGF5ZXIgY29tbWl0cyBoYXNoKHNlY3JldCkgLSB0aGUgc2VjcmV0IHN0YXlzIGhpZGRlbgAAAAAAAAtjb21taXRfc2VlZAAAAAADAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAB1QbGF5ZXIgMSBjcmVhdGVzIGEgZ2FtZSBsb2JieQAAAAAAAAtjcmVhdGVfZ2FtZQAAAAADAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAdwbGF5ZXIxAAAAABMAAAAAAAAADnBsYXllcjFfcG9pbnRzAAAAAAALAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAG5SZXZlYWwgeW91ciBzZWNyZXQgc2VlZCAoWksgc3RlcCAyKQpQbGF5ZXIgcmV2ZWFscyB0aGUgb3JpZ2luYWwgc2VlZCAtIGNvbnRyYWN0IHZlcmlmaWVzIGl0IG1hdGNoZXMgY29tbWl0bWVudAAAAAAAC3JldmVhbF9zZWVkAAAAAAMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAAEc2VlZAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAADFTdGFydCBhIG5ldyByb3VuZCAoZ2VuZXJhdGVzIHNoZWxscyBmcm9tIFpLIHNlZWQpAAAAAAAAC3N0YXJ0X3JvdW5kAAAAAAEAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIZ2FtZV9odWIAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAOc2hvb3Rfb3Bwb25lbnQAAAAAAAIAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAEAAAPpAAAAAQAAAAM=",
        "AAAAAAAAADVGaW5hbGl6ZSBnYW1lIHN0YXJ0IGFmdGVyIFpLIHJldmVhbCAoYW55b25lIGNhbiBjYWxsKQAAAAAAABNmaW5hbGl6ZV9nYW1lX3N0YXJ0AAAAAAEAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAATZ2V0X3NlZWRfY29tbWl0bWVudAAAAAACAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAABAAAD6AAAB9AAAAAOU2VlZENvbW1pdG1lbnQAAA=="]),
      options
    )
  }
  public readonly fromJSON = {
    get_hub: this.txFromJSON<string>,
    set_hub: this.txFromJSON<null>,
    upgrade: this.txFromJSON<null>,
    get_game: this.txFromJSON<Result<Game>>,
    get_admin: this.txFromJSON<string>,
    join_game: this.txFromJSON<Result<void>>,
    set_admin: this.txFromJSON<null>,
    shoot_self: this.txFromJSON<Result<boolean>>,
    commit_seed: this.txFromJSON<Result<void>>,
    create_game: this.txFromJSON<Result<void>>,
    reveal_seed: this.txFromJSON<Result<void>>,
    start_round: this.txFromJSON<Result<void>>,
    shoot_opponent: this.txFromJSON<Result<boolean>>,
    finalize_game_start: this.txFromJSON<Result<void>>,
    get_seed_commitment: this.txFromJSON<Option<SeedCommitment>>
  }
}