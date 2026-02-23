#![cfg(test)]

use crate::{ZkDuelContract, ZkDuelContractClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, IntoVal};

// ============================================================================
// Mock GameHub for Unit Testing
// ============================================================================

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
        // Mock implementation - does nothing
    }

    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {
        // Mock implementation - does nothing
    }
}

// ============================================================================
// Test Helpers
// ============================================================================

fn setup_test() -> (Env, ZkDuelContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    // Set ledger info
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

    // Deploy mock GameHub
    let hub_addr = env.register(MockGameHub, ());

    // Create admin
    let admin = Address::generate(&env);

    // Deploy zk-duel
    let contract_id = env.register(ZkDuelContract, (&admin, &hub_addr));
    let client = ZkDuelContractClient::new(&env, &contract_id);

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    (env, client, player1, player2)
}

fn create_commitment(env: &Env, move_val: u32, item_val: u32, salt: &BytesN<32>) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.append(&move_val.to_be_bytes().into_val(env));
    data.append(&item_val.to_be_bytes().into_val(env));
    data.append(&salt.clone().into());
    env.crypto().keccak256(&data).into()
}

// ============================================================================
// Game Logic Tests
// ============================================================================

#[test]
fn test_full_game_flow() {
    let (env, client, p1, p2) = setup_test();
    let session_id = 1u32;
    let points = 100i128;

    // Start Game
    client.start_game(&session_id, &p1, &p2, &points, &points);

    let game = client.get_game(&session_id);
    assert_eq!(game.p1_health, 3);
    assert_eq!(game.p2_health, 3);
    assert_eq!(game.turn, 1);

    // --- TURN 1 ---
    // P1: Rock (1) + Saw (1)
    // P2: Scissors (3) + None (0)
    // Result: P1 wins RPS (Rock > Scissors). Saw activates (Double Dmg).
    // P2 Health: 3 -> 1.

    let salt1 = BytesN::from_array(&env, &[1u8; 32]);
    let salt2 = BytesN::from_array(&env, &[2u8; 32]);

    let c1 = create_commitment(&env, 1, 1, &salt1); // Rock, Saw
    let c2 = create_commitment(&env, 3, 0, &salt2); // Scissors, None

    client.commit_move(&session_id, &p1, &c1);
    client.commit_move(&session_id, &p2, &c2);

    // Reveal
    client.reveal_move(&session_id, &p1, &1, &1, &salt1);
    client.reveal_move(&session_id, &p2, &3, &0, &salt2);

    // Check State
    let game = client.get_game(&session_id);
    assert_eq!(game.p1_health, 3);
    assert_eq!(game.p2_health, 1); // 3 - 2 = 1
    assert_eq!(game.turn, 2);
    assert!(game.winner.is_none());

    // --- TURN 2 ---
    // P1: Paper (2) + None (0)
    // P2: Rock (1) + Shield (3)
    // Result: P1 wins RPS (Paper > Rock). P2 has Shield.
    // Dmg: 1. Shield reduces by 1 -> 0 Dmg.
    // P2 Health: 1 -> 1.

    let salt3 = BytesN::from_array(&env, &[3u8; 32]);
    let salt4 = BytesN::from_array(&env, &[4u8; 32]);

    let c3 = create_commitment(&env, 2, 0, &salt3); // Paper, None
    let c4 = create_commitment(&env, 1, 3, &salt4); // Rock, Shield

    client.commit_move(&session_id, &p1, &c3);
    client.commit_move(&session_id, &p2, &c4);

    client.reveal_move(&session_id, &p1, &2, &0, &salt3);
    client.reveal_move(&session_id, &p2, &1, &3, &salt4);

    let game = client.get_game(&session_id);
    assert_eq!(game.p1_health, 3);
    assert_eq!(game.p2_health, 1); // Unchanged due to Shield
    assert_eq!(game.turn, 3);

    // --- TURN 3 (FATALITY) ---
    // P1: Scissors (3) + None (0)
    // P2: Paper (2) + None (0)
    // Result: P1 wins. Dmg 1.
    // P2 Health: 1 -> 0. Game Over.

    let salt5 = BytesN::from_array(&env, &[5u8; 32]);
    let salt6 = BytesN::from_array(&env, &[6u8; 32]);

    let c5 = create_commitment(&env, 3, 0, &salt5);
    let c6 = create_commitment(&env, 2, 0, &salt6);

    client.commit_move(&session_id, &p1, &c5);
    client.commit_move(&session_id, &p2, &c6);

    client.reveal_move(&session_id, &p1, &3, &0, &salt5);
    client.reveal_move(&session_id, &p2, &2, &0, &salt6);

    let game = client.get_game(&session_id);
    assert_eq!(game.p2_health, 0);
    assert_eq!(game.winner, Some(p1));
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_cheating_reveal() {
    let (env, client, p1, p2) = setup_test();
    let session_id = 1u32;
    client.start_game(&session_id, &p1, &p2, &100, &100);

    let salt = BytesN::from_array(&env, &[1u8; 32]);
    let c1 = create_commitment(&env, 1, 0, &salt); // Committed ROCK
    let c2 = create_commitment(&env, 1, 0, &salt); // P2 commits ROCK too

    client.commit_move(&session_id, &p1, &c1);
    client.commit_move(&session_id, &p2, &c2); // NOW both are committed

    // Try to reveal PAPER (2) instead of ROCK (1)
    client.reveal_move(&session_id, &p1, &2, &0, &salt);
}
