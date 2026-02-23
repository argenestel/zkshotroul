#![no_std]

//! # ZK Duel: The Cursed Hand
//!
//! A high-stakes Rock-Paper-Scissors game with hidden items and provable commitments.
//! Inspired by Buckshot Roulette mechanics.
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
    AlreadyCommitted = 3,
    BothPlayersNotCommitted = 4,
    GameAlreadyEnded = 5,
    InvalidMove = 6,
    InvalidItem = 7,
    CommitmentMismatch = 8,
    AlreadyRevealed = 9,
}

// ============================================================================
// Data Types
// ============================================================================

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Move {
    None = 0,
    Rock = 1,
    Paper = 2,
    Scissors = 3,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Item {
    None = 0,
    Saw = 1,       // Double damage on win
    Handcuffs = 2, // Opponent skips next turn (simplified: play same move?) -> Actually, let's make it simpler: Opponent takes 1 damage immediately if they lose? No, stick to Saw=Double Dmg.
    // Let's keep it simple for V1: Just Saw (Double Damage) and Shield (Block 1 Damage)
    Shield = 3, // Block 1 damage
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player1: Address,
    pub player2: Address,
    pub p1_health: u32,
    pub p2_health: u32,
    pub turn: u32,

    // Commitments (Hash of Move + Item + Salt)
    pub p1_commit: Option<BytesN<32>>,
    pub p2_commit: Option<BytesN<32>>,

    // Revealed Moves (Temporary storage for the current turn resolution)
    pub p1_revealed_move: Move,
    pub p1_revealed_item: Item,
    pub p2_revealed_move: Move,
    pub p2_revealed_item: Item,

    pub winner: Option<Address>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Game(u32),
    GameHubAddress,
    Admin,
}

// ============================================================================
// Storage TTL Management
// ============================================================================

const GAME_TTL_LEDGERS: u32 = 518_400; // 30 days

// ============================================================================
// Contract Definition
// ============================================================================

#[contract]
pub struct ZkDuelContract;

#[contractimpl]
impl ZkDuelContract {
    pub fn __constructor(env: Env, admin: Address, game_hub: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &game_hub);
    }

    pub fn start_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    ) -> Result<(), Error> {
        if player1 == player2 {
            panic!("Cannot play against yourself");
        }

        player1.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player1_points.into_val(&env),
        ]);
        player2.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player2_points.into_val(&env),
        ]);

        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");
        let game_hub = GameHubClient::new(&env, &game_hub_addr);

        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        let game = Game {
            player1: player1.clone(),
            player2: player2.clone(),
            p1_health: 3, // Start with 3 lives
            p2_health: 3,
            turn: 1,
            p1_commit: None,
            p2_commit: None,
            p1_revealed_move: Move::None,
            p1_revealed_item: Item::None,
            p2_revealed_move: Move::None,
            p2_revealed_item: Item::None,
            winner: None,
        };

        let game_key = DataKey::Game(session_id);
        env.storage().temporary().set(&game_key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&game_key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Commit a hashed move + item + salt
    /// This keeps the move hidden until both players have committed.
    pub fn commit_move(
        env: Env,
        session_id: u32,
        player: Address,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }

        if player == game.player1 {
            if game.p1_commit.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            game.p1_commit = Some(commitment);
        } else if player == game.player2 {
            if game.p2_commit.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            game.p2_commit = Some(commitment);
        } else {
            return Err(Error::NotPlayer);
        }

        env.storage().temporary().set(&key, &game);
        Ok(())
    }

    /// Reveal the move and item.
    /// Can only be called after BOTH players have committed.
    /// The contract verifies the hash matches the commitment.
    pub fn reveal_move(
        env: Env,
        session_id: u32,
        player: Address,
        move_val: u32,
        item_val: u32,
        salt: BytesN<32>,
    ) -> Result<(), Error> {
        // No auth required to reveal (anyone can submit the reveal if they know the salt),
        // but typically the player does it.

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }

        // Check both committed
        if game.p1_commit.is_none() || game.p2_commit.is_none() {
            return Err(Error::BothPlayersNotCommitted);
        }

        let move_enum = match move_val {
            1 => Move::Rock,
            2 => Move::Paper,
            3 => Move::Scissors,
            _ => return Err(Error::InvalidMove),
        };

        let item_enum = match item_val {
            0 => Item::None,
            1 => Item::Saw,
            3 => Item::Shield,
            _ => return Err(Error::InvalidItem),
        };

        // Reconstruct Hash
        // Hash(move_u32 + item_u32 + salt_bytes)
        let mut data = Bytes::new(&env);
        data.append(&move_val.to_be_bytes().into_val(&env));
        data.append(&item_val.to_be_bytes().into_val(&env));
        data.append(&salt.into());

        let calculated_hash: BytesN<32> = env.crypto().keccak256(&data).into();

        if player == game.player1 {
            if game.p1_revealed_move != Move::None {
                return Err(Error::AlreadyRevealed);
            }
            let stored_hash = game.p1_commit.clone().unwrap();
            if calculated_hash != stored_hash {
                return Err(Error::CommitmentMismatch);
            }
            game.p1_revealed_move = move_enum;
            game.p1_revealed_item = item_enum;
        } else if player == game.player2 {
            if game.p2_revealed_move != Move::None {
                return Err(Error::AlreadyRevealed);
            }
            let stored_hash = game.p2_commit.clone().unwrap();
            if calculated_hash != stored_hash {
                return Err(Error::CommitmentMismatch);
            }
            game.p2_revealed_move = move_enum;
            game.p2_revealed_item = item_enum;
        } else {
            return Err(Error::NotPlayer);
        }

        // If both revealed, resolve the round
        if game.p1_revealed_move != Move::None && game.p2_revealed_move != Move::None {
            Self::resolve_round(&env, &mut game, session_id)?;
        } else {
            // Save partial state
            env.storage().temporary().set(&key, &game);
        }

        Ok(())
    }

    fn resolve_round(env: &Env, game: &mut Game, session_id: u32) -> Result<(), Error> {
        let m1 = game.p1_revealed_move;
        let m2 = game.p2_revealed_move;
        let i1 = game.p1_revealed_item;
        let i2 = game.p2_revealed_item;

        let mut p1_dmg = 1;
        let mut p2_dmg = 1;

        // Apply Items
        if i1 == Item::Saw {
            p1_dmg = 2;
        }
        if i2 == Item::Saw {
            p2_dmg = 2;
        }
        // Shield logic: If opponent has shield, reduce incoming damage by 1 (min 0)
        // Note: Shield applies to damage RECEIVED.

        // Determine Winner of RPS
        // Rock(1) beats Scissors(3)
        // Scissors(3) beats Paper(2)
        // Paper(2) beats Rock(1)

        let p1_wins = (m1 == Move::Rock && m2 == Move::Scissors)
            || (m1 == Move::Scissors && m2 == Move::Paper)
            || (m1 == Move::Paper && m2 == Move::Rock);

        let p2_wins = (m2 == Move::Rock && m1 == Move::Scissors)
            || (m2 == Move::Scissors && m1 == Move::Paper)
            || (m2 == Move::Paper && m1 == Move::Rock);

        if p1_wins {
            // P1 hits P2
            if i2 == Item::Shield {
                p1_dmg = if p1_dmg > 0 { p1_dmg - 1 } else { 0 };
            }
            game.p2_health = if game.p2_health > p1_dmg {
                game.p2_health - p1_dmg
            } else {
                0
            };
        } else if p2_wins {
            // P2 hits P1
            if i1 == Item::Shield {
                p2_dmg = if p2_dmg > 0 { p2_dmg - 1 } else { 0 };
            }
            game.p1_health = if game.p1_health > p2_dmg {
                game.p1_health - p2_dmg
            } else {
                0
            };
        } else {
            // Tie - No damage
        }

        // Clear commitments and reveals for next turn
        game.p1_commit = None;
        game.p2_commit = None;
        game.p1_revealed_move = Move::None;
        game.p1_revealed_item = Item::None;
        game.p2_revealed_move = Move::None;
        game.p2_revealed_item = Item::None;
        game.turn += 1;

        // Check for Game Over
        if game.p1_health == 0 || game.p2_health == 0 {
            let winner = if game.p1_health > 0 {
                game.player1.clone()
            } else if game.p2_health > 0 {
                game.player2.clone()
            } else {
                // Double KO? Tie goes to P1 in this simple version, or draw.
                // Let's say P1 wins ties for simplicity or maybe check who had higher health before?
                // For now, P1 wins ties.
                game.player1.clone()
            };

            game.winner = Some(winner.clone());

            // End Game in Hub
            let game_hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .unwrap();
            let game_hub = GameHubClient::new(&env, &game_hub_addr);
            let player1_won = winner == game.player1;
            game_hub.end_game(&session_id, &player1_won);
        }

        env.storage()
            .temporary()
            .set(&DataKey::Game(session_id), game);

        Ok(())
    }

    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        let key = DataKey::Game(session_id);
        env.storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)
    }

    // Admin Boilerplate
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
