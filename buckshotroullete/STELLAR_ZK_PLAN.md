# Buckshot Roulette - Stellar ZK Integration Plan

## Overview

This document outlines the plan for integrating the Buckshot Roulette game with the Stellar Game Studio ecosystem using Soroban smart contracts and ZK-style commit-reveal mechanisms.

---

## Game Design Decision

### ZK Approach: Turn-based Commit-Reveal

After analysis, we determined that **Turn-based Commit-Reveal** is the best approach for Buckshot Roulette on-chain.

**Why?**
- Buckshot Roulette is a **Turn-Based** game, not simultaneous
- The "Hidden Information" is the **Shell Sequence** (Live vs Blank)
- We cannot easily hide the shell sequence on a public ledger if the contract generates it
- **Solution:** Use a **Shared Seed Commit-Reveal Scheme** to generate the shell sequence fairly

---

## What Moves Need to be ZK Committed?

### 1. Round Seed Commitment (Fair Randomness)

| Phase | Action | Purpose |
|-------|--------|---------|
| **Commit** | Both players commit a secret salt | Prevents prediction of shell sequence |
| **Reveal** | Both players reveal their salts | Generates fair random seed |
| **Generate** | Contract derives shell sequence from combined seeds | Neither player can manipulate outcome |

### 2. Turn Actions (Transparency)

| Action | On-Chain? | ZK Required? |
|--------|-----------|--------------|
| **Shoot Dealer** | Yes | No (public action) |
| **Shoot Self** | Yes | No (public action) |
| **Shell Result** | Contract-determined | Derived from committed seed |

---

## Contract Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    GAME HUB                              │
│  (Manages sessions, points, and game lifecycle)          │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              BUCKSHOT ROULETTE CONTRACT                  │
├─────────────────────────────────────────────────────────┤
│  start_game(session_id, p1, p2, points)                 │
│  commit_round_seed(session_id, player, commitment)      │
│  reveal_round_seed(session_id, player, salt)            │
│  shoot_self(session_id, player)                         │
│  shoot_opponent(session_id, player)                     │
│  get_game(session_id) -> Game                           │
└─────────────────────────────────────────────────────────┘
```

---

## Game State Structure

```rust
struct Game {
    // Players
    player1: Address,
    player2: Address,
    
    // Health (starting at 4)
    p1_health: u32,
    p2_health: u32,
    
    // Round tracking
    round: u32,
    turn: u32,  // 1 = player1, 2 = player2
    
    // ZK Commitments for shell sequence seed
    p1_seed_commit: Option<BytesN<32>>,
    p2_seed_commit: Option<BytesN<32>>,
    p1_seed_revealed: Option<BytesN<32>>,
    p2_seed_revealed: Option<BytesN<32>>,
    
    // Shell sequence (generated after both reveal)
    shells: Vec<ShellType>,  // Live or Blank
    current_shell_index: u32,
    
    // Game result
    winner: Option<Address>,
}

enum ShellType {
    Live = 1,
    Blank = 0,
}
```

---

## Game Flow

### Phase 1: Game Start
```
Player1 ──────► start_game(session_id, p1, p2, points)
                    │
                    ▼
              Game Hub: Lock Points
                    │
                    ▼
              Initialize Game State
```

### Phase 2: Round Seed Commitment (ZK)
```
Player1 ──────► commit_round_seed(session_id, hash(salt1))
Player2 ──────► commit_round_seed(session_id, hash(salt2))
```

### Phase 3: Round Seed Reveal
```
Player1 ──────► reveal_round_seed(session_id, salt1)
Player2 ──────► reveal_round_seed(session_id, salt2)
                    │
                    ▼
              Contract generates shell sequence:
              seed = keccak256(salt1 + salt2 + session_id)
              shells = derive_shells_from_seed(seed)
```

### Phase 4: Turn-based Gameplay
```
Current Player ──► shoot_self(session_id)
              OR
Current Player ──► shoot_opponent(session_id)
                    │
                    ▼
              Contract pops next shell
              Applies damage if LIVE
              Checks for extra turn if BLANK + self-shot
              Updates health
              Checks for game over
```

### Phase 5: Game End
```
Game Over ──────► Game Hub: end_game(session_id, winner)
                    │
                    ▼
              Game Hub: Distribute Points
```

---

## Shell Sequence Generation (Deterministic)

```rust
fn generate_shells(env: &Env, seed: BytesN<32>, round: u32) -> Vec<ShellType> {
    let mut shells = Vec::new(&env);
    
    // Determine number of live/blank shells using seed
    env.prng().seed(seed.into());
    
    let live_count = env.prng().gen_range::<u64>(1..=4) as u32;
    let blank_count = env.prng().gen_range::<u64>(1..=4) as u32;
    
    // Create shells
    for _ in 0..live_count {
        shells.push(ShellType::Live);
    }
    for _ in 0..blank_count {
        shells.push(ShellType::Blank);
    }
    
    // Shuffle using seed
    // Fisher-Yates shuffle with deterministic randomness
    for i in (1..shells.len()).rev() {
        let j = env.prng().gen_range::<u64>(0..=i as u64) as usize;
        shells.swap(i, j);
    }
    
    shells
}
```

---

## Contract Functions

### Core Game Functions

| Function | Description | Auth Required |
|----------|-------------|---------------|
| `start_game` | Initialize game, lock points | Both players |
| `commit_round_seed` | Commit secret salt for shell generation | Current player |
| `reveal_round_seed` | Reveal salt to generate shells | Current player |
| `shoot_self` | Shoot yourself with current shell | Current player |
| `shoot_opponent` | Shoot opponent with current shell | Current player |
| `get_game` | Query game state | None |
| `get_shells_remaining` | Get count of remaining shells | None |

### Admin Functions

| Function | Description |
|----------|-------------|
| `get_admin` | Get admin address |
| `set_admin` | Update admin |
| `get_hub` | Get Game Hub address |
| `set_hub` | Update Game Hub address |
| `upgrade` | Upgrade contract WASM |

---

## Error Codes

```rust
enum Error {
    GameNotFound = 1,
    NotPlayer = 2,
    AlreadyCommitted = 3,
    BothPlayersNotCommitted = 4,
    GameAlreadyEnded = 5,
    InvalidMove = 6,
    NotYourTurn = 7,
    CommitmentMismatch = 8,
    AlreadyRevealed = 9,
    NoShellsRemaining = 10,
}
```

---

## Frontend Integration

### Files to Create/Modify

```
buckshotroullete/
├── contracts/
│   └── buckshot-roulette/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           └── test.rs
├── src/
│   ├── bindings.ts          # Generated from contract
│   ├── stellar/
│   │   ├── contract.ts      # Contract interaction wrapper
│   │   ├── wallet.ts        # Wallet connection
│   │   └── utils.ts         # Helper functions
│   └── games/
│       └── buckshot-roulette/
│           ├── BuckshotRoulette.tsx
│           └── game-service.ts
└── public/
    └── game-studio-config.js
```

### Key Frontend Tasks

1. **Wallet Integration**
   - Connect Freighter wallet
   - Handle multi-sig for game start

2. **Contract Binding**
   - Generate TypeScript bindings
   - Wrap contract calls in service layer

3. **Game State Sync**
   - Poll `get_game()` for state updates
   - Update Three.js scene based on on-chain state

4. **ZK Commitment UI**
   - Generate random salt client-side
   - Display commitment hash
   - Handle reveal phase

---

## Step-by-Step Implementation Plan

### Step 1: Create Contract Scaffold
```bash
cd /home/arg/projects/stellar/Stellar-Game-Studio
bun run create buckshot-roulette
```

### Step 2: Implement Contract Logic
- [ ] Define Game struct and ShellType enum
- [ ] Implement `start_game` with Game Hub integration
- [ ] Implement `commit_round_seed`
- [ ] Implement `reveal_round_seed` with shell generation
- [ ] Implement `shoot_self` and `shoot_opponent`
- [ ] Implement damage calculation and turn logic
- [ ] Implement game over detection
- [ ] Implement `end_game` call to Game Hub

### Step 3: Write Tests
- [ ] Test game start and initialization
- [ ] Test commit-reveal flow
- [ ] Test shell sequence generation determinism
- [ ] Test shooting mechanics
- [ ] Test extra turn on blank self-shot
- [ ] Test game over scenarios
- [ ] Test cheating prevention (invalid reveals)

### Step 4: Build & Deploy
```bash
bun run build buckshot-roulette
bun run deploy buckshot-roulette
bun run bindings buckshot-roulette
```

### Step 5: Frontend Integration
- [ ] Copy bindings to buckshotroullete frontend
- [ ] Create wallet connection service
- [ ] Create contract service wrapper
- [ ] Connect Three.js game to contract state
- [ ] Implement ZK commitment UI flow
- [ ] Test full game loop on testnet

---

## Security Considerations

### Preventing Manipulation
1. **Shell Sequence**: Generated from combined salts - neither player can predict
2. **Commitment Binding**: Players bound to their commitment via hash
3. **Reveal Timing**: Both must commit before either can reveal
4. **Deterministic RNG**: Uses `env.prng()` with seed, not ledger data

### On-Chain Transparency
- All actions are recorded on-chain
- Shell sequence is derivable by anyone after reveal
- Game state is fully queryable

---

## Testing Checklist

- [ ] Game starts correctly with Game Hub
- [ ] Both players can commit seeds
- [ ] Reveal generates consistent shell sequence
- [ ] Cannot reveal before both commit
- [ ] Cannot reveal with wrong salt
- [ ] Shoot self works correctly
- [ ] Shoot opponent works correctly
- [ ] Damage calculation is correct
- [ ] Extra turn on blank self-shot
- [ ] Game ends when health reaches 0
- [ ] Points distributed correctly
- [ ] Contract handles edge cases

---

## Resources

- [Stellar Game Studio AGENTS.md](../Stellar-Game-Studio/AGENTS.md)
- [zk-duel Contract Reference](../Stellar-Game-Studio/contracts/zk-duel/src/lib.rs)
- [dice-duel Contract Reference](../Stellar-Game-Studio/contracts/dice-duel/src/lib.rs)
- [Soroban Documentation](https://soroban.stellar.org/docs)

---

## Timeline Estimate

| Phase | Duration | Tasks |
|-------|----------|-------|
| Contract Development | 2-3 days | Core logic, tests |
| Contract Deployment | 1 day | Build, deploy, bindings |
| Frontend Integration | 2-3 days | Wallet, service, UI |
| Testing & QA | 1-2 days | Full game loop testing |
| **Total** | **6-9 days** | |

---

## Next Steps

1. **Immediate**: Create contract scaffold using `bun run create buckshot-roulette`
2. **Priority**: Implement core game logic in `lib.rs`
3. **Parallel**: Set up frontend project structure for Stellar integration
4. **Review**: Test commit-reveal mechanism thoroughly
5. **Deploy**: Deploy to testnet and integrate with Game Hub

---

*Document created: 2026-02-22*
*Status: Planning Complete - Ready for Implementation*
