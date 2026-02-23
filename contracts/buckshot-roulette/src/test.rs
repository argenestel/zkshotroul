#![cfg(test)]

use crate::{BuckshotRouletteContract, BuckshotRouletteContractClient, GameStatus};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, Env};

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
    }

    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {}
}

// ============================================================================
// Test Helpers
// ============================================================================

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

// ============================================================================
// Game Logic Tests
// ============================================================================

#[test]
fn test_create_game() {
    let (_env, client, p1, _p2) = setup_test();
    let session_id = 1u32;
    let points = 100i128;

    client.create_game(&session_id, &p1, &points);

    let game = client.get_game(&session_id);
    assert_eq!(game.p1_health, 4);
    assert_eq!(game.p2_health, 4);
    assert!(matches!(game.status, GameStatus::WaitingForPlayer2));
    assert!(game.player2.is_none());
}

#[test]
fn test_join_game() {
    let (_env, client, p1, p2) = setup_test();
    let session_id = 1u32;

    client.create_game(&session_id, &p1, &100);
    client.join_game(&session_id, &p2, &100);

    let game = client.get_game(&session_id);
    assert!(matches!(game.status, GameStatus::Ready));
    assert!(game.player2.is_some());
    assert_eq!(game.player2.unwrap(), p2);
}

#[test]
fn test_start_game() {
    let (_env, client, p1, p2) = setup_test();
    let session_id = 1u32;

    client.create_game(&session_id, &p1, &100);
    client.join_game(&session_id, &p2, &100);
    client.start_game(&session_id);
    client.start_round(&session_id);

    let game = client.get_game(&session_id);
    assert!(matches!(game.status, GameStatus::InProgress));
    assert!(game.shells_remaining > 0);
}

#[test]
fn test_shoot_self_blank_gives_extra_turn() {
    let (_env, client, p1, p2) = setup_test();
    let session_id = 1u32;

    client.create_game(&session_id, &p1, &100);
    client.join_game(&session_id, &p2, &100);
    client.start_game(&session_id);
    client.start_round(&session_id);

    let initial_game = client.get_game(&session_id);
    let initial_shells = initial_game.shells_remaining;

    let is_live = client.shoot_self(&session_id, &p1);

    let game = client.get_game(&session_id);

    if is_live {
        assert_eq!(game.turn, 2);
    } else {
        assert_eq!(game.turn, 1);
    }

    assert_eq!(game.shells_remaining, initial_shells - 1);
}

#[test]
fn test_shoot_opponent_switches_turn() {
    let (_env, client, p1, p2) = setup_test();
    let session_id = 1u32;

    client.create_game(&session_id, &p1, &100);
    client.join_game(&session_id, &p2, &100);
    client.start_game(&session_id);
    client.start_round(&session_id);

    let _ = client.shoot_opponent(&session_id, &p1);

    let game = client.get_game(&session_id);
    assert_eq!(game.turn, 2);
}

#[test]
fn test_game_over() {
    let (_env, client, p1, p2) = setup_test();
    let session_id = 1u32;

    client.create_game(&session_id, &p1, &100);
    client.join_game(&session_id, &p2, &100);
    client.start_game(&session_id);
    client.start_round(&session_id);

    let mut game = client.get_game(&session_id);

    while game.winner.is_none() && game.shells_remaining > 0 {
        if game.turn == 1 {
            let _ = client.shoot_opponent(&session_id, &p1);
        } else {
            let _ = client.shoot_opponent(&session_id, &p2);
        }

        game = client.get_game(&session_id);

        if game.shells_remaining == 0 && game.winner.is_none() {
            client.start_round(&session_id);
            game = client.get_game(&session_id);
        }
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_not_your_turn() {
    let (_env, client, p1, p2) = setup_test();
    let session_id = 1u32;

    client.create_game(&session_id, &p1, &100);
    client.join_game(&session_id, &p2, &100);
    client.start_game(&session_id);
    client.start_round(&session_id);

    client.shoot_opponent(&session_id, &p2);
}

#[test]
#[should_panic(expected = "Cannot play against yourself")]
fn test_cannot_play_yourself() {
    let (_env, client, p1, _p2) = setup_test();
    let session_id = 1u32;

    client.create_game(&session_id, &p1, &100);
    client.join_game(&session_id, &p1, &100);
}
