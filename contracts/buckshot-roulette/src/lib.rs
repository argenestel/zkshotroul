#![no_std]

//! # Buckshot Roulette - ZK Edition
//!
//! A high-stakes shotgun game with ZK commit-reveal for fair shell generation.
//!
//! **ZK Commit-Reveal Protocol:**
//! 1. Each player commits hash(secret_seed) before game starts
//! 2. Both players reveal their seeds
//! 3. Combined seeds generate shell sequence deterministically
//! 4. Neither player can predict or manipulate the outcome

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, vec, Address, Bytes,
    BytesN, Env, IntoVal, Vec,
};

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
    SeedsNotRevealed = 10,
    WaitingForOpponentCommit = 11,
    WaitingForOpponentReveal = 12,
    CannotPlayYourself = 13,
}

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
    AwaitingSeeds,  // Both players joined, waiting for seed commits
    AwaitingReveal, // Both committed, waiting for reveals
    InProgress,
    Ended,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player1: Address,
    pub player2: Option<Address>,
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
    // ZK Shell info (revealed after commit-reveal)
    pub live_count: u32,
    pub blank_count: u32,
}

// ZK Commitment storage
#[contracttype]
#[derive(Clone)]
pub struct SeedCommitment {
    pub commitment: BytesN<32>, // hash(seed)
    pub revealed: bool,
    pub seed: Option<BytesN<32>>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Game(u32),
    GameHubAddress,
    Admin,
    P1Commitment(u32), // session_id -> player1's commitment
    P2Commitment(u32), // session_id -> player2's commitment
    CombinedSeed(u32), // session_id -> combined seed after reveal
}

const GAME_TTL_LEDGERS: u32 = 518_400;

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

    // ========================================================================
    // ZK Commit-Reveal for Seed Generation
    // ========================================================================

    /// Commit your secret seed (ZK step 1)
    /// Player commits hash(secret) - the secret stays hidden
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

        if game.status == GameStatus::Ended {
            return Err(Error::GameAlreadyEnded);
        }

        let is_player1 = player == game.player1;
        let is_player2 = game.player2.as_ref() == Some(&player);

        if !is_player1 && !is_player2 {
            return Err(Error::NotPlayer);
        }

        let seed_commitment = SeedCommitment {
            commitment,
            revealed: false,
            seed: None,
        };

        if is_player1 {
            let commit_key = DataKey::P1Commitment(session_id);
            if env.storage().temporary().has(&commit_key) {
                return Err(Error::AlreadyCommitted);
            }
            env.storage().temporary().set(&commit_key, &seed_commitment);
        } else {
            let commit_key = DataKey::P2Commitment(session_id);
            if env.storage().temporary().has(&commit_key) {
                return Err(Error::AlreadyCommitted);
            }
            env.storage().temporary().set(&commit_key, &seed_commitment);
        }

        // Check if both players have committed
        let p1_key = DataKey::P1Commitment(session_id);
        let p2_key = DataKey::P2Commitment(session_id);

        if env.storage().temporary().has(&p1_key) && env.storage().temporary().has(&p2_key) {
            let mut game = game;
            game.status = GameStatus::AwaitingReveal;
            env.storage().temporary().set(&key, &game);
        }

        Ok(())
    }

    /// Reveal your secret seed (ZK step 2)
    /// Player reveals the original seed - contract verifies it matches commitment
    pub fn reveal_seed(
        env: Env,
        session_id: u32,
        player: Address,
        seed: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.status != GameStatus::AwaitingReveal {
            return Err(Error::WaitingForOpponentCommit);
        }

        let is_player1 = player == game.player1;
        let is_player2 = game.player2.as_ref() == Some(&player);

        if !is_player1 && !is_player2 {
            return Err(Error::NotPlayer);
        }

        // Verify commitment
        let commit_key = if is_player1 {
            DataKey::P1Commitment(session_id)
        } else {
            DataKey::P2Commitment(session_id)
        };

        let mut stored: SeedCommitment = env.storage().temporary().get(&commit_key).unwrap();

        if stored.revealed {
            return Err(Error::AlreadyRevealed);
        }

        // Verify hash matches commitment (ZK proof verification)
        let seed_bytes: Bytes = seed.clone().into();
        let computed_hash: BytesN<32> = env.crypto().keccak256(&seed_bytes).into();
        if computed_hash != stored.commitment {
            return Err(Error::CommitmentMismatch);
        }

        // Store revealed seed
        stored.revealed = true;
        stored.seed = Some(seed);
        env.storage().temporary().set(&commit_key, &stored);

        // Check if both have revealed
        let p1_key = DataKey::P1Commitment(session_id);
        let p2_key = DataKey::P2Commitment(session_id);
        let p1: SeedCommitment = env.storage().temporary().get(&p1_key).unwrap();
        let p2: SeedCommitment = env.storage().temporary().get(&p2_key).unwrap();

        if p1.revealed && p2.revealed {
            // Combine seeds to generate combined seed (ZK complete)
            let combined = Self::combine_seeds(&env, p1.seed.unwrap(), p2.seed.unwrap());
            env.storage()
                .temporary()
                .set(&DataKey::CombinedSeed(session_id), &combined);
        }

        Ok(())
    }

    /// Combine two seeds to create a deterministic combined seed
    fn combine_seeds(env: &Env, seed1: BytesN<32>, seed2: BytesN<32>) -> BytesN<32> {
        let mut combined = Bytes::new(env);
        combined.append(&seed1.clone().into());
        combined.append(&seed2.clone().into());
        env.crypto().keccak256(&combined).into()
    }

    // ========================================================================
    // Shell Generation from ZK Seed
    // ========================================================================

    /// Generate shells deterministically from combined ZK seed
    fn generate_shells_from_seed(env: &Env, combined_seed: BytesN<32>, round: u32) -> (u32, u32) {
        // Use combined seed + round for deterministic generation
        let mut seed_bytes = Bytes::new(env);
        seed_bytes.append(&combined_seed.clone().into());
        seed_bytes.append(&Bytes::from_array(env, &round.to_be_bytes()));
        let round_seed = env.crypto().keccak256(&seed_bytes);

        env.prng().seed(round_seed.into());

        // Generate 2-6 shells
        let total = env.prng().gen_range::<u64>(2..=6) as u32;

        // 1-3 live shells (at least 1, at most half)
        let live_count = env.prng().gen_range::<u64>(1..=(total as u64 / 2)) as u32;
        let blank_count = total - live_count;

        (live_count, blank_count)
    }

    /// Get shell at position (uses ZK combined seed for deterministic result)
    fn get_shell_at(
        env: &Env,
        session_id: u32,
        round: u32,
        index: u32,
        live_count: u32,
        blank_count: u32,
    ) -> ShellType {
        // Retrieve combined seed
        let seed_key = DataKey::CombinedSeed(session_id);
        let combined_seed: BytesN<32> = env.storage().temporary().get(&seed_key).unwrap();

        // Create deterministic seed for this specific shell position
        let mut seed_bytes = Bytes::new(env);
        seed_bytes.append(&combined_seed.clone().into());
        seed_bytes.append(&Bytes::from_array(env, &round.to_be_bytes()));
        seed_bytes.append(&Bytes::from_array(env, &index.to_be_bytes()));
        let shell_seed = env.crypto().keccak256(&seed_bytes);

        env.prng().seed(shell_seed.into());

        // Use Fisher-Yates style assignment
        // Total positions = live_count + blank_count
        // At position index, determine if live or blank
        let total = live_count + blank_count;
        let remaining = total - index;

        if remaining == 0 {
            return ShellType::Blank;
        }

        // Probability of live = remaining_live / remaining_total
        // Use threshold to determine
        let threshold = env.prng().gen_range::<u64>(0..remaining as u64) as u32;

        if threshold < live_count {
            ShellType::Live
        } else {
            ShellType::Blank
        }
    }

    // ========================================================================
    // Game Lifecycle
    // ========================================================================

    /// Player 1 creates a game lobby
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
            live_count: 0,
            blank_count: 0,
        };

        let game_key = DataKey::Game(session_id);
        env.storage().temporary().set(&game_key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&game_key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Player 2 joins the game
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
            return Err(Error::CannotPlayYourself);
        }

        game.player2 = Some(player2.clone());
        game.player2_points = player2_points;
        game.status = GameStatus::AwaitingSeeds; // Now waiting for ZK commits

        env.storage().temporary().set(&key, &game);

        Ok(())
    }

    /// Finalize game start after ZK reveal (anyone can call)
    pub fn finalize_game_start(env: Env, session_id: u32) -> Result<(), Error> {
        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        // Verify both seeds are revealed
        let seed_key = DataKey::CombinedSeed(session_id);
        if !env.storage().temporary().has(&seed_key) {
            return Err(Error::SeedsNotRevealed);
        }

        let combined_seed: BytesN<32> = env.storage().temporary().get(&seed_key).unwrap();
        let player2 = game.player2.clone().unwrap();

        // Call Game Hub
        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .unwrap();
        let game_hub = GameHubClient::new(&env, &game_hub_addr);
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &game.player1,
            &player2,
            &game.player1_points,
            &game.player2_points,
        );

        // Generate first round shells from ZK seed
        let (live_count, blank_count) = Self::generate_shells_from_seed(&env, combined_seed, 1);

        game.status = GameStatus::InProgress;
        game.live_count = live_count;
        game.blank_count = blank_count;
        game.shells_remaining = live_count + blank_count;
        game.round = 1;

        env.storage().temporary().set(&key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Start a new round (generates shells from ZK seed)
    pub fn start_round(env: Env, session_id: u32) -> Result<(), Error> {
        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.status != GameStatus::InProgress {
            return Err(Error::GameAlreadyEnded);
        }

        let seed_key = DataKey::CombinedSeed(session_id);
        let combined_seed: BytesN<32> = env.storage().temporary().get(&seed_key).unwrap();

        let (live_count, blank_count) =
            Self::generate_shells_from_seed(&env, combined_seed, game.round);

        game.live_count = live_count;
        game.blank_count = blank_count;
        game.shells_remaining = live_count + blank_count;
        game.current_shell_index = 0;

        env.storage().temporary().set(&key, &game);

        Ok(())
    }

    // ========================================================================
    // Gameplay Actions
    // ========================================================================

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

        // Get shell from ZK-generated sequence
        let shell = Self::get_shell_at(
            &env,
            session_id,
            game.round,
            game.current_shell_index,
            game.live_count,
            game.blank_count,
        );
        let is_live = shell == ShellType::Live;

        if is_live {
            if is_player1 {
                game.p1_health = game.p1_health.saturating_sub(1);
            } else {
                game.p2_health = game.p2_health.saturating_sub(1);
            }
        }

        game.current_shell_index += 1;
        game.shells_remaining -= 1;

        // Check game over
        if game.p1_health == 0 || game.p2_health == 0 {
            let winner = if game.p1_health > 0 {
                game.player1.clone()
            } else {
                game.player2.clone().unwrap()
            };
            game.winner = Some(winner);
            game.status = GameStatus::Ended;

            let game_hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .unwrap();
            let game_hub = GameHubClient::new(&env, &game_hub_addr);
            game_hub.end_game(&session_id, &(game.p1_health > 0));
        } else if !is_live {
            // Blank on self = extra turn (no turn switch)
        } else {
            game.turn = if game.turn == 1 { 2 } else { 1 };
        }

        if game.shells_remaining == 0 && game.winner.is_none() {
            game.round += 1;
        }

        env.storage().temporary().set(&key, &game);
        Ok(is_live)
    }

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

        let shell = Self::get_shell_at(
            &env,
            session_id,
            game.round,
            game.current_shell_index,
            game.live_count,
            game.blank_count,
        );
        let is_live = shell == ShellType::Live;

        if is_live {
            if is_player1 {
                game.p2_health = game.p2_health.saturating_sub(1);
            } else {
                game.p1_health = game.p1_health.saturating_sub(1);
            }
        }

        game.current_shell_index += 1;
        game.shells_remaining -= 1;
        game.turn = if game.turn == 1 { 2 } else { 1 };

        if game.p1_health == 0 || game.p2_health == 0 {
            let winner = if game.p1_health > 0 {
                game.player1.clone()
            } else {
                game.player2.clone().unwrap()
            };
            game.winner = Some(winner);
            game.status = GameStatus::Ended;

            let game_hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .unwrap();
            let game_hub = GameHubClient::new(&env, &game_hub_addr);
            game_hub.end_game(&session_id, &(game.p1_health > 0));
        }

        if game.shells_remaining == 0 && game.winner.is_none() {
            game.round += 1;
        }

        env.storage().temporary().set(&key, &game);
        Ok(is_live)
    }

    // ========================================================================
    // View Functions
    // ========================================================================

    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        let key = DataKey::Game(session_id);
        env.storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)
    }

    pub fn get_seed_commitment(
        env: Env,
        session_id: u32,
        player: Address,
    ) -> Option<SeedCommitment> {
        let key = DataKey::Game(session_id);
        let game: Game = env.storage().temporary().get(&key)?;

        if game.player1 == player {
            env.storage()
                .temporary()
                .get(&DataKey::P1Commitment(session_id))
        } else if game.player2.as_ref() == Some(&player) {
            env.storage()
                .temporary()
                .get(&DataKey::P2Commitment(session_id))
        } else {
            None
        }
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn get_hub(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .unwrap()
    }

    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[cfg(test)]
mod test;
