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
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CBUCOZAI3Z43CAGB4EX2XAMSVM3IMLIPKYABP7PPRTCV4EELVNHTGQT5",
  }
} as const


export interface Game {
  current_shell_index: u32;
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
  1: {message:"GameNotFound"},
  2: {message:"NotPlayer"},
  3: {message:"GameAlreadyEnded"},
  4: {message:"NotYourTurn"},
  5: {message:"NoShellsRemaining"},
  6: {message:"AlreadyCommitted"},
  7: {message:"BothPlayersNotCommitted"},
  8: {message:"CommitmentMismatch"},
  9: {message:"AlreadyRevealed"}
}

export type DataKey = {tag: "Game", values: readonly [u32]} | {tag: "GameHubAddress", values: void} | {tag: "Admin", values: void} | {tag: "Shells", values: readonly [u32]} | {tag: "Seeds", values: readonly [u32]};

export enum ShellType {
  Blank = 0,
  Live = 1,
}

export type GameStatus = {tag: "WaitingForPlayer2", values: void} | {tag: "Ready", values: void} | {tag: "InProgress", values: void} | {tag: "Ended", values: void};

export interface Client {
  /**
   * Construct and simulate a get_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_hub: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_hub: ({new_hub}: {new_hub: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get game state
   */
  get_game: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Game>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a join_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Join an existing game (Player 2 joins)
   */
  join_game: ({session_id, player2, player2_points}: {session_id: u32, player2: string, player2_points: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a shoot_self transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Shoot yourself with the current shell
   */
  shoot_self: ({session_id, player}: {session_id: u32, player: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<boolean>>>

  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Start the game (both players ready) - calls Game Hub
   */
  start_game: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a commit_seed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Commit a seed for shell generation (ZK commitment)
   */
  commit_seed: ({session_id, player, commitment}: {session_id: u32, player: string, commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a new game lobby (Player 1 starts)
   */
  create_game: ({session_id, player1, player1_points}: {session_id: u32, player1: string, player1_points: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a start_round transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Start a new round (generates shells)
   */
  start_round: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a shoot_opponent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Shoot opponent with the current shell
   */
  shoot_opponent: ({session_id, player}: {session_id: u32, player: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<boolean>>>

  /**
   * Construct and simulate a get_shell_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get shell info for current round (count only, not revealed)
   */
  get_shell_count: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, game_hub}: {admin: string, game_hub: string},
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
    return ContractClient.deploy({admin, game_hub}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAABEdhbWUAAAAMAAAAAAAAABNjdXJyZW50X3NoZWxsX2luZGV4AAAAAAQAAAAAAAAACXAxX2hlYWx0aAAAAAAAAAQAAAAAAAAACXAyX2hlYWx0aAAAAAAAAAQAAAAAAAAAB3BsYXllcjEAAAAAEwAAAAAAAAAOcGxheWVyMV9wb2ludHMAAAAAAAsAAAAAAAAAB3BsYXllcjIAAAAD6AAAABMAAAAAAAAADnBsYXllcjJfcG9pbnRzAAAAAAALAAAAAAAAAAVyb3VuZAAAAAAAAAQAAAAAAAAAEHNoZWxsc19yZW1haW5pbmcAAAAEAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAKR2FtZVN0YXR1cwAAAAAAAAAAAAR0dXJuAAAABAAAAAAAAAAGd2lubmVyAAAAAAPoAAAAEw==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAQAAAAAAAAAJTm90UGxheWVyAAAAAAAAAgAAAAAAAAAQR2FtZUFscmVhZHlFbmRlZAAAAAMAAAAAAAAAC05vdFlvdXJUdXJuAAAAAAQAAAAAAAAAEU5vU2hlbGxzUmVtYWluaW5nAAAAAAAABQAAAAAAAAAQQWxyZWFkeUNvbW1pdHRlZAAAAAYAAAAAAAAAF0JvdGhQbGF5ZXJzTm90Q29tbWl0dGVkAAAAAAcAAAAAAAAAEkNvbW1pdG1lbnRNaXNtYXRjaAAAAAAACAAAAAAAAAAPQWxyZWFkeVJldmVhbGVkAAAAAAk=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAEAAAAAAAAABEdhbWUAAAABAAAABAAAAAAAAAAAAAAADkdhbWVIdWJBZGRyZXNzAAAAAAAAAAAAAAAAAAVBZG1pbgAAAAAAAAEAAAAAAAAABlNoZWxscwAAAAAAAQAAAAQAAAABAAAAAAAAAAVTZWVkcwAAAAAAAAEAAAAE",
        "AAAAAwAAAAAAAAAAAAAACVNoZWxsVHlwZQAAAAAAAAIAAAAAAAAABUJsYW5rAAAAAAAAAAAAAAAAAAAETGl2ZQAAAAE=",
        "AAAAAgAAAAAAAAAAAAAACkdhbWVTdGF0dXMAAAAAAAQAAAAAAAAAAAAAABFXYWl0aW5nRm9yUGxheWVyMgAAAAAAAAAAAAAAAAAABVJlYWR5AAAAAAAAAAAAAAAAAAAKSW5Qcm9ncmVzcwAAAAAAAAAAAAAAAAAFRW5kZWQAAAA=",
        "AAAAAAAAAAAAAAAHZ2V0X2h1YgAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAHc2V0X2h1YgAAAAABAAAAAAAAAAduZXdfaHViAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAA5HZXQgZ2FtZSBzdGF0ZQAAAAAACGdldF9nYW1lAAAAAQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAEAAAPpAAAH0AAAAARHYW1lAAAAAw==",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAACZKb2luIGFuIGV4aXN0aW5nIGdhbWUgKFBsYXllciAyIGpvaW5zKQAAAAAACWpvaW5fZ2FtZQAAAAAAAAMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAB3BsYXllcjIAAAAAEwAAAAAAAAAOcGxheWVyMl9wb2ludHMAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAACVTaG9vdCB5b3Vyc2VsZiB3aXRoIHRoZSBjdXJyZW50IHNoZWxsAAAAAAAACnNob290X3NlbGYAAAAAAAIAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAEAAAPpAAAAAQAAAAM=",
        "AAAAAAAAADRTdGFydCB0aGUgZ2FtZSAoYm90aCBwbGF5ZXJzIHJlYWR5KSAtIGNhbGxzIEdhbWUgSHViAAAACnN0YXJ0X2dhbWUAAAAAAAEAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAADJDb21taXQgYSBzZWVkIGZvciBzaGVsbCBnZW5lcmF0aW9uIChaSyBjb21taXRtZW50KQAAAAAAC2NvbW1pdF9zZWVkAAAAAAMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAClDcmVhdGUgYSBuZXcgZ2FtZSBsb2JieSAoUGxheWVyIDEgc3RhcnRzKQAAAAAAAAtjcmVhdGVfZ2FtZQAAAAADAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAdwbGF5ZXIxAAAAABMAAAAAAAAADnBsYXllcjFfcG9pbnRzAAAAAAALAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAACRTdGFydCBhIG5ldyByb3VuZCAoZ2VuZXJhdGVzIHNoZWxscykAAAALc3RhcnRfcm91bmQAAAAAAQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIZ2FtZV9odWIAAAATAAAAAA==",
        "AAAAAAAAACVTaG9vdCBvcHBvbmVudCB3aXRoIHRoZSBjdXJyZW50IHNoZWxsAAAAAAAADnNob290X29wcG9uZW50AAAAAAACAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAABAAAD6QAAAAEAAAAD",
        "AAAAAAAAADtHZXQgc2hlbGwgaW5mbyBmb3IgY3VycmVudCByb3VuZCAoY291bnQgb25seSwgbm90IHJldmVhbGVkKQAAAAAPZ2V0X3NoZWxsX2NvdW50AAAAAAEAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAABAAAD6QAAAAQAAAAD" ]),
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
        start_game: this.txFromJSON<Result<void>>,
        commit_seed: this.txFromJSON<Result<void>>,
        create_game: this.txFromJSON<Result<void>>,
        start_round: this.txFromJSON<Result<void>>,
        shoot_opponent: this.txFromJSON<Result<boolean>>,
        get_shell_count: this.txFromJSON<Result<u32>>
  }
}