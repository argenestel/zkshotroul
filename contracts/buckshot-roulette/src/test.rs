#![cfg(test)]

use crate::{BuckshotRouletteContract, BuckshotRouletteContractClient, GameStatus, SeedCommitment};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct MockGameHub;

#[contractimpl]
impl MockGameHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session_id: u32,
        _player1: Address,
        _player2: Address,
        _player1_points: i128,
        _player2_points: i128,
    ) {
    }

    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {}
}

fn setup_test() -> (
    Env,
    BuckshotRouletteContractClient<'static>,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1441065600,
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });

    let hub_addr = env.register(MockGameHub, ());
    let admin = Address::generate(&env);
    let contract_id = env.register(BuckshotRouletteContract, (&admin, &hub_addr));
    let client = BuckshotRouletteContractClient::new(&env, &contract_id);

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    (env, client, player1, player2)
}

fn hash_seed(env: &Env, seed: &BytesN<32>) -> BytesN<32> {
    env.crypto().keccak256(&seed.clone().into()).into()
}

#[test]
fn test_zk_commit_reveal_flow() {
    let (env, client, p1, p2) = setup_test();
    let session_id = 1u32;

    // Create game
    client.create_game(&session_id, &p1, &100);

    // Join game
    client.join_game(&session_id, &p2, &100);

    let game = client.get_game(&session_id);
    assert!(matches!(game.status, GameStatus::AwaitingSeeds));

    // ZK Step 1: Both players commit their seeds
    let p1_seed = BytesN::<32>::from_array(&env, &[1u8; 32]);
    let p2_seed = BytesN::<32>::from_array(&env, &[2u8; 32]);

    let p1_commitment = hash_seed(&env, &p1_seed);
    let p2_commitment = hash_seed(&env, &p2_seed);

    client.commit_seed(&session_id, &p1, &p1_commitment);
    client.commit_seed(&session_id, &p2, &p2_commitment);

    let game = client.get_game(&session_id);
    assert!(matches!(game.status, GameStatus::AwaitingReveal));

    // ZK Step 2: Both players reveal
    client.reveal_seed(&session_id, &p1, &p1_seed);
    client.reveal_seed(&session_id, &p2, &p2_seed);

    // Finalize and start
    client.finalize_game_start(&session_id);

    let game = client.get_game(&session_id);
    assert!(matches!(game.status, GameStatus::InProgress));
    assert!(game.live_count > 0);
    assert!(game.blank_count > 0);
    assert!(game.shells_remaining > 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_zk_invalid_reveal_fails() {
    let (env, client, p1, p2) = setup_test();
    let session_id = 1u32;

    client.create_game(&session_id, &p1, &100);
    client.join_game(&session_id, &p2, &100);

    let p1_seed = BytesN::<32>::from_array(&env, &[1u8; 32]);
    let wrong_seed = BytesN::<32>::from_array(&env, &[99u8; 32]);

    let p1_commitment = hash_seed(&env, &p1_seed);
    let p2_commitment = hash_seed(&env, &wrong_seed);

    client.commit_seed(&session_id, &p1, &p1_commitment);
    client.commit_seed(&session_id, &p2, &p2_commitment);

    // Try to reveal wrong seed (should fail)
    client.reveal_seed(&session_id, &p1, &wrong_seed);
}

#[test]
fn test_deterministic_shells() {
    let (env, client, p1, p2) = setup_test();
    let session_id = 1u32;

    client.create_game(&session_id, &p1, &100);
    client.join_game(&session_id, &p2, &100);

    let p1_seed = BytesN::<32>::from_array(&env, &[42u8; 32]);
    let p2_seed = BytesN::<32>::from_array(&env, &[24u8; 32]);

    let p1_commitment = hash_seed(&env, &p1_seed);
    let p2_commitment = hash_seed(&env, &p2_seed);

    client.commit_seed(&session_id, &p1, &p1_commitment);
    client.commit_seed(&session_id, &p2, &p2_commitment);

    client.reveal_seed(&session_id, &p1, &p1_seed);
    client.reveal_seed(&session_id, &p2, &p2_seed);

    client.finalize_game_start(&session_id);

    let game1 = client.get_game(&session_id);

    // Query again - should be same
    let game2 = client.get_game(&session_id);

    assert_eq!(game1.live_count, game2.live_count);
    assert_eq!(game1.blank_count, game2.blank_count);
}

#[test]
fn test_gameplay_after_zk() {
    let (env, client, p1, p2) = setup_test();
    let session_id = 1u32;

    // Full ZK flow
    client.create_game(&session_id, &p1, &100);
    client.join_game(&session_id, &p2, &100);

    let p1_seed = BytesN::<32>::from_array(&env, &[1u8; 32]);
    let p2_seed = BytesN::<32>::from_array(&env, &[2u8; 32]);

    client.commit_seed(&session_id, &p1, &hash_seed(&env, &p1_seed));
    client.commit_seed(&session_id, &p2, &hash_seed(&env, &p2_seed));
    client.reveal_seed(&session_id, &p1, &p1_seed);
    client.reveal_seed(&session_id, &p2, &p2_seed);
    client.finalize_game_start(&session_id);

    // Now play
    let _ = client.shoot_opponent(&session_id, &p1);

    let game = client.get_game(&session_id);
    assert_eq!(game.turn, 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_cannot_reveal_before_both_commit() {
    let (env, client, p1, _p2) = setup_test();
    let session_id = 1u32;

    client.create_game(&session_id, &p1, &100);

    let seed = BytesN::<32>::from_array(&env, &[1u8; 32]);
    let commitment = hash_seed(&env, &seed);

    client.commit_seed(&session_id, &p1, &commitment);

    // Try to reveal before player2 commits
    client.reveal_seed(&session_id, &p1, &seed);
}
