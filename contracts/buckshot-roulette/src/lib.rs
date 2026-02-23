#![no_std]

//! # Buckshot Roulette
//!
//! A high-stakes shotgun game where players take turns shooting themselves or each other.
//! The gun is loaded with a mix of live and blank shells.
//!
//! **Game Hub Integration:**
//! This game is Game Hub-aware and enforces all games to be played through the
//! Game Hub contract. Games cannot be started or completed without points involvement.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, vec, Address, Bytes,
    BytesN, Env, IntoVal,
};

// Import GameHub contract interface
#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    GameNotFound = 1,
    NotPlayer = 2,
    GameAlreadyEnded = 3,
    NotYourTurn = 4,
    NoShellsRemaining = 5,
    AlreadyCommitted = 6,
    BothPlayersNotCommitted = 7,
    CommitmentMismatch = 8,
    AlreadyRevealed = 9,
}

// ============================================================================
// Data Types
// ============================================================================

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ShellType {
    Blank = 0,
    Live = 1,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GameStatus {
    WaitingForPlayer2,
    Ready,
    InProgress,
    Ended,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player1: Address,
    pub player2: Option<Address>, // None until player2 joins
    pub p1_health: u32,
    pub p2_health: u32,
    pub turn: u32,
    pub round: u32,
    pub shells_remaining: u32,
    pub current_shell_index: u32,
    pub winner: Option<Address>,
    pub status: GameStatus,
    pub player1_points: i128,
    pub player2_points: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Game(u32),
    GameHubAddress,
    Admin,
    Shells(u32), // session_id -> shell sequence
    Seeds(u32),  // session_id -> combined seed for shell generation
}

// ============================================================================
// Storage TTL Management
// ============================================================================

const GAME_TTL_LEDGERS: u32 = 518_400; // 30 days

// ============================================================================
// Contract Definition
// ============================================================================

#[contract]
pub struct BuckshotRouletteContract;

#[contractimpl]
impl BuckshotRouletteContract {
    pub fn __constructor(env: Env, admin: Address, game_hub: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &game_hub);
    }

    /// Create a new game lobby (Player 1 starts)
    pub fn create_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player1_points: i128,
    ) -> Result<(), Error> {
        player1.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player1_points.into_val(&env),
        ]);

        let game = Game {
            player1: player1.clone(),
            player2: None,
            p1_health: 4,
            p2_health: 4,
            turn: 1,
            round: 1,
            shells_remaining: 0,
            current_shell_index: 0,
            winner: None,
            status: GameStatus::WaitingForPlayer2,
            player1_points,
            player2_points: 0,
        };

        let game_key = DataKey::Game(session_id);
        env.storage().temporary().set(&game_key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&game_key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Join an existing game (Player 2 joins)
    pub fn join_game(
        env: Env,
        session_id: u32,
        player2: Address,
        player2_points: i128,
    ) -> Result<(), Error> {
        player2.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player2_points.into_val(&env),
        ]);

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.status != GameStatus::WaitingForPlayer2 {
            return Err(Error::GameAlreadyEnded);
        }

        if game.player1 == player2 {
            panic!("Cannot play against yourself");
        }

        game.player2 = Some(player2.clone());
        game.player2_points = player2_points;
        game.status = GameStatus::Ready;

        env.storage().temporary().set(&key, &game);

        Ok(())
    }

    /// Start the game (both players ready) - calls Game Hub
    pub fn start_game(env: Env, session_id: u32) -> Result<(), Error> {
        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.status != GameStatus::Ready {
            return Err(Error::GameAlreadyEnded);
        }

        let player2 = game.player2.as_ref().ok_or(Error::NotPlayer)?;

        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");
        let game_hub = GameHubClient::new(&env, &game_hub_addr);

        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &game.player1,
            player2,
            &game.player1_points,
            &game.player2_points,
        );

        game.status = GameStatus::InProgress;
        env.storage().temporary().set(&key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Commit a seed for shell generation (ZK commitment)
    pub fn commit_seed(
        env: Env,
        session_id: u32,
        player: Address,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }

        // Store commitment (simplified - in production you'd store both players' commitments)
        // For now, we'll use a simpler approach where the contract generates shells

        Ok(())
    }

    /// Generate shells for the round using deterministic RNG
    fn generate_shells(env: &Env, session_id: u32, round: u32) -> u32 {
        // Use session_id and round as seed for deterministic generation
        let mut seed_bytes = Bytes::new(env);
        seed_bytes.append(&Bytes::from_array(env, &session_id.to_be_bytes()));
        seed_bytes.append(&Bytes::from_array(env, &round.to_be_bytes()));
        let seed = env.crypto().keccak256(&seed_bytes);

        env.prng().seed(seed.into());

        // Generate 2-6 shells with 1-3 live shells
        let total_shells = env.prng().gen_range::<u64>(2..=6) as u32;
        total_shells
    }

    /// Get the shell type at current position (deterministic)
    fn get_shell_at(env: &Env, session_id: u32, round: u32, index: u32, total: u32) -> ShellType {
        let mut seed_bytes = Bytes::new(env);
        seed_bytes.append(&Bytes::from_array(env, &session_id.to_be_bytes()));
        seed_bytes.append(&Bytes::from_array(env, &round.to_be_bytes()));
        seed_bytes.append(&Bytes::from_array(env, &index.to_be_bytes()));
        let seed = env.crypto().keccak256(&seed_bytes);

        env.prng().seed(seed.into());

        // Determine live count based on total
        let live_count = env.prng().gen_range::<u64>(1..=(total as u64 / 2)) as u32;

        if index < live_count {
            ShellType::Live
        } else {
            ShellType::Blank
        }
    }

    /// Start a new round (generates shells)
    pub fn start_round(env: Env, session_id: u32) -> Result<(), Error> {
        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.status != GameStatus::InProgress && game.status != GameStatus::Ready {
            return Err(Error::GameAlreadyEnded);
        }

        // Generate new shells for this round
        let total_shells = Self::generate_shells(&env, session_id, game.round);
        game.shells_remaining = total_shells;
        game.current_shell_index = 0;

        env.storage().temporary().set(&key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Shoot yourself with the current shell
    pub fn shoot_self(env: Env, session_id: u32, player: Address) -> Result<bool, Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.status != GameStatus::InProgress {
            return Err(Error::GameAlreadyEnded);
        }

        if game.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }

        // Verify it's the player's turn
        let is_player1 = player == game.player1;
        let is_player2 = game.player2.as_ref() == Some(&player);

        if !is_player1 && !is_player2 {
            return Err(Error::NotPlayer);
        }

        let current_turn = if is_player1 { 1u32 } else { 2u32 };
        if game.turn != current_turn {
            return Err(Error::NotYourTurn);
        }

        if game.shells_remaining == 0 {
            return Err(Error::NoShellsRemaining);
        }

        // Get current shell
        let shell = Self::get_shell_at(
            &env,
            session_id,
            game.round,
            game.current_shell_index,
            game.shells_remaining + game.current_shell_index,
        );

        let is_live = shell == ShellType::Live;
        let mut extra_turn = false;

        if is_live {
            // Take damage
            if is_player1 {
                game.p1_health = game.p1_health.saturating_sub(1);
            } else {
                game.p2_health = game.p2_health.saturating_sub(1);
            }
        } else {
            // Blank on self = extra turn
            extra_turn = true;
        }

        // Advance shell
        game.current_shell_index += 1;
        game.shells_remaining -= 1;

        // Check for game over
        if game.p1_health == 0 || game.p2_health == 0 {
            let winner = if game.p1_health > 0 {
                game.player1.clone()
            } else {
                game.player2.clone().unwrap()
            };
            game.winner = Some(winner);
            game.status = GameStatus::Ended;

            // End game in hub
            let game_hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .unwrap();
            let game_hub = GameHubClient::new(&env, &game_hub_addr);
            let player1_won = game.p1_health > 0;
            game_hub.end_game(&session_id, &player1_won);
        } else if !extra_turn {
            // Switch turn
            game.turn = if game.turn == 1 { 2 } else { 1 };
        }

        // Check if round is over
        if game.shells_remaining == 0 && game.winner.is_none() {
            game.round += 1;
        }

        env.storage().temporary().set(&key, &game);

        Ok(is_live)
    }

    /// Shoot opponent with the current shell
    pub fn shoot_opponent(env: Env, session_id: u32, player: Address) -> Result<bool, Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.status != GameStatus::InProgress {
            return Err(Error::GameAlreadyEnded);
        }

        if game.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }

        let is_player1 = player == game.player1;
        let is_player2 = game.player2.as_ref() == Some(&player);

        if !is_player1 && !is_player2 {
            return Err(Error::NotPlayer);
        }

        let current_turn = if is_player1 { 1u32 } else { 2u32 };
        if game.turn != current_turn {
            return Err(Error::NotYourTurn);
        }

        if game.shells_remaining == 0 {
            return Err(Error::NoShellsRemaining);
        }

        // Get current shell
        let shell = Self::get_shell_at(
            &env,
            session_id,
            game.round,
            game.current_shell_index,
            game.shells_remaining + game.current_shell_index,
        );

        let is_live = shell == ShellType::Live;

        if is_live {
            // Opponent takes damage
            if is_player1 {
                game.p2_health = game.p2_health.saturating_sub(1);
            } else {
                game.p1_health = game.p1_health.saturating_sub(1);
            }
        }

        // Advance shell
        game.current_shell_index += 1;
        game.shells_remaining -= 1;

        // Always switch turn after shooting opponent
        game.turn = if game.turn == 1 { 2 } else { 1 };

        // Check for game over
        if game.p1_health == 0 || game.p2_health == 0 {
            let winner = if game.p1_health > 0 {
                game.player1.clone()
            } else {
                game.player2.clone().unwrap()
            };
            game.winner = Some(winner);
            game.status = GameStatus::Ended;

            // End game in hub
            let game_hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .unwrap();
            let game_hub = GameHubClient::new(&env, &game_hub_addr);
            let player1_won = game.p1_health > 0;
            game_hub.end_game(&session_id, &player1_won);
        }

        // Check if round is over
        if game.shells_remaining == 0 && game.winner.is_none() {
            game.round += 1;
        }

        env.storage().temporary().set(&key, &game);

        Ok(is_live)
    }

    /// Get game state
    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        let key = DataKey::Game(session_id);
        env.storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)
    }

    /// Get shell info for current round (count only, not revealed)
    pub fn get_shell_count(env: Env, session_id: u32) -> Result<u32, Error> {
        let key = DataKey::Game(session_id);
        let game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;
        Ok(game.shells_remaining)
    }

    // Admin functions
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn get_hub(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set")
    }

    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[cfg(test)]
mod test;
