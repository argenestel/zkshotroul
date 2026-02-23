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
    contractId: "CDULKIQFZ42ZF3HQKR3TYGBJ7CKY5F745VTTLJIOKWFF3MNOGZHPQFP6",
  }
} as const


export interface Game {
  p1_commit: Option<Buffer>;
  p1_health: u32;
  p1_revealed_item: Item;
  p1_revealed_move: Move;
  p2_commit: Option<Buffer>;
  p2_health: u32;
  p2_revealed_item: Item;
  p2_revealed_move: Move;
  player1: string;
  player2: string;
  turn: u32;
  winner: Option<string>;
}

export enum Item {
  None = 0,
  Saw = 1,
  Handcuffs = 2,
  Shield = 3,
}

export enum Move {
  None = 0,
  Rock = 1,
  Paper = 2,
  Scissors = 3,
}

export const Errors = {
  1: {message:"GameNotFound"},
  2: {message:"NotPlayer"},
  3: {message:"AlreadyCommitted"},
  4: {message:"BothPlayersNotCommitted"},
  5: {message:"GameAlreadyEnded"},
  6: {message:"InvalidMove"},
  7: {message:"InvalidItem"},
  8: {message:"CommitmentMismatch"},
  9: {message:"AlreadyRevealed"}
}

export type DataKey = {tag: "Game", values: readonly [u32]} | {tag: "GameHubAddress", values: void} | {tag: "Admin", values: void};

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
   */
  get_game: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Game>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  start_game: ({session_id, player1, player2, player1_points, player2_points}: {session_id: u32, player1: string, player2: string, player1_points: i128, player2_points: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a commit_move transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Commit a hashed move + item + salt
   * This keeps the move hidden until both players have committed.
   */
  commit_move: ({session_id, player, commitment}: {session_id: u32, player: string, commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reveal_move transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reveal the move and item.
   * Can only be called after BOTH players have committed.
   * The contract verifies the hash matches the commitment.
   */
  reveal_move: ({session_id, player, move_val, item_val, salt}: {session_id: u32, player: string, move_val: u32, item_val: u32, salt: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAABEdhbWUAAAAMAAAAAAAAAAlwMV9jb21taXQAAAAAAAPoAAAD7gAAACAAAAAAAAAACXAxX2hlYWx0aAAAAAAAAAQAAAAAAAAAEHAxX3JldmVhbGVkX2l0ZW0AAAfQAAAABEl0ZW0AAAAAAAAAEHAxX3JldmVhbGVkX21vdmUAAAfQAAAABE1vdmUAAAAAAAAACXAyX2NvbW1pdAAAAAAAA+gAAAPuAAAAIAAAAAAAAAAJcDJfaGVhbHRoAAAAAAAABAAAAAAAAAAQcDJfcmV2ZWFsZWRfaXRlbQAAB9AAAAAESXRlbQAAAAAAAAAQcDJfcmV2ZWFsZWRfbW92ZQAAB9AAAAAETW92ZQAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAABHR1cm4AAAAEAAAAAAAAAAZ3aW5uZXIAAAAAA+gAAAAT",
        "AAAAAwAAAAAAAAAAAAAABEl0ZW0AAAAEAAAAAAAAAAROb25lAAAAAAAAAAAAAAADU2F3AAAAAAEAAAAAAAAACUhhbmRjdWZmcwAAAAAAAAIAAAAAAAAABlNoaWVsZAAAAAAAAw==",
        "AAAAAwAAAAAAAAAAAAAABE1vdmUAAAAEAAAAAAAAAAROb25lAAAAAAAAAAAAAAAEUm9jawAAAAEAAAAAAAAABVBhcGVyAAAAAAAAAgAAAAAAAAAIU2Npc3NvcnMAAAAD",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAQAAAAAAAAAJTm90UGxheWVyAAAAAAAAAgAAAAAAAAAQQWxyZWFkeUNvbW1pdHRlZAAAAAMAAAAAAAAAF0JvdGhQbGF5ZXJzTm90Q29tbWl0dGVkAAAAAAQAAAAAAAAAEEdhbWVBbHJlYWR5RW5kZWQAAAAFAAAAAAAAAAtJbnZhbGlkTW92ZQAAAAAGAAAAAAAAAAtJbnZhbGlkSXRlbQAAAAAHAAAAAAAAABJDb21taXRtZW50TWlzbWF0Y2gAAAAAAAgAAAAAAAAAD0FscmVhZHlSZXZlYWxlZAAAAAAJ",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAEAAAAAAAAABEdhbWUAAAABAAAABAAAAAAAAAAAAAAADkdhbWVIdWJBZGRyZXNzAAAAAAAAAAAAAAAAAAVBZG1pbgAAAA==",
        "AAAAAAAAAAAAAAAHZ2V0X2h1YgAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAHc2V0X2h1YgAAAAABAAAAAAAAAAduZXdfaHViAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+kAAAfQAAAABEdhbWUAAAAD",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAKc3RhcnRfZ2FtZQAAAAAABQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAADnBsYXllcjFfcG9pbnRzAAAAAAALAAAAAAAAAA5wbGF5ZXIyX3BvaW50cwAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAGBDb21taXQgYSBoYXNoZWQgbW92ZSArIGl0ZW0gKyBzYWx0ClRoaXMga2VlcHMgdGhlIG1vdmUgaGlkZGVuIHVudGlsIGJvdGggcGxheWVycyBoYXZlIGNvbW1pdHRlZC4AAAALY29tbWl0X21vdmUAAAAAAwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAIZSZXZlYWwgdGhlIG1vdmUgYW5kIGl0ZW0uCkNhbiBvbmx5IGJlIGNhbGxlZCBhZnRlciBCT1RIIHBsYXllcnMgaGF2ZSBjb21taXR0ZWQuClRoZSBjb250cmFjdCB2ZXJpZmllcyB0aGUgaGFzaCBtYXRjaGVzIHRoZSBjb21taXRtZW50LgAAAAAAC3JldmVhbF9tb3ZlAAAAAAUAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAAIbW92ZV92YWwAAAAEAAAAAAAAAAhpdGVtX3ZhbAAAAAQAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIZ2FtZV9odWIAAAATAAAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_hub: this.txFromJSON<string>,
        set_hub: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        get_game: this.txFromJSON<Result<Game>>,
        get_admin: this.txFromJSON<string>,
        set_admin: this.txFromJSON<null>,
        start_game: this.txFromJSON<Result<void>>,
        commit_move: this.txFromJSON<Result<void>>,
        reveal_move: this.txFromJSON<Result<void>>
  }
}