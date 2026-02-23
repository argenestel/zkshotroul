# Buckshot Roulette (Stellar ZK Edition)

## 💀 Overview
**Buckshot Roulette** is a high-stakes, tense 2-player Russian Roulette variant played with a 12-gauge shotgun. Built for the Stellar network using Soroban smart contracts, this version replaces the traditional honor system with cryptographic proof.

Players take turns pulling the trigger on themselves or their opponent. The catch? The sequence of live and blank shells is randomly generated and hidden using **Zero-Knowledge (ZK) Commit-Reveal Schemes**, ensuring absolute fairness and preventing either player (or the smart contract itself) from knowing or predicting the bullet sequence ahead of time.

## 🎯 Game Mechanics
1. **The Setup:** The dealer loads a shotgun with a hidden sequence of **Live** and **Blank** shells.
2. **The Turn:** On your turn, you must choose to shoot:
   - **Yourself:** If you survive (it's a blank), you get an extra turn. If it's live, you take damage.
   - **The Dealer (Opponent):** If it's live, they take damage. If it's a blank, you lose your turn.
3. **The Goal:** Drain the opponent's health to 0 before they drain yours.
4. **The End:** When the shotgun is empty, a new round begins with a completely new, cryptographically secure sequence of shells.

## 🔒 Special Features & Architecture

### Cryptographically Fair RNG (ZK Commit-Reveal)
Unlike traditional web3 games where on-chain RNG can be manipulated by validators or front-run by players, Buckshot Roulette uses a robust Commit-Reveal protocol:
- **Phase 1 (Commit):** Both players generate a random local seed, hash it, and submit the hash to the Stellar smart contract.
- **Phase 2 (Reveal):** Once both hashes are locked, players reveal their original seeds. 
- **Generation:** The contract combines both seeds to deterministically generate the sequence of shells. Since neither player knows the other's seed until both are committed, the outcome is perfectly random and mathematically impossible to cheat.

### Immersive Retro 3D Visualization
The game features a fully custom Three.js rendering pipeline designed to emulate gritty, old-school PS1/CRT aesthetics:
- **Procedural 3D Models:** Detailed, generated models for the pump-action shotgun, interrogation table, and a menacing dealer opponent.
- **Custom Shader Pipeline:** A bespoke post-processing CRT shader applies barrel distortion, chromatic aberration, scanlines, atmospheric noise, and vignette to the entire scene.
- **Dynamic Lighting & Audio:** Harsh, dramatic spotlights cast soft shadows across the table, accompanied by a procedurally generated, deeply ominous Web Audio API sub-bass drone that pulses in the background.
- **Reactive Animations:** The shotgun physically recoils and emits dynamic muzzle flashes that illuminate the room based on whose turn it is and whether the round fired is live or blank.

### Seamless Wallet Integration
Built entirely on the **Stellar Game Studio** framework, the game supports instant connections with Freighter and other Stellar wallets, utilizing session keys to allow seamless, fast-paced turns without intrusive pop-ups on every shot.

---
*Built with ♥️ from game developers who loves Stellar.*
