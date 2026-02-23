import { useState } from 'react';
import { TwentyOneGame } from '../games/twenty-one/TwentyOneGame';
import { NumberGuessGame } from '../games/number-guess/NumberGuessGame';
import { DiceDuelGame } from '../games/dice-duel/DiceDuelGame';
import { BuckshotRouletteGame } from '../games/buckshot-roulette/BuckshotRouletteGame';
import { useWallet } from '@/hooks/useWallet';
import typezeroHero from '../assets/typezero-hero.png';
import xrayHero from '../assets/xray-hero.png';
import './GamesCatalog.css';

const games = [
  {
    id: 'buckshot-roulette',
    title: 'Buckshot Roulette',
    emoji: '🔫',
    description: 'High-stakes shotgun game with ZK commit-reveal for fair shell generation.',
    tags: ['2 players', 'ZK Enabled', 'Featured'],
    featured: true,
  },
  {
    id: 'twenty-one',
    title: 'Twenty-One',
    emoji: '🃏',
    description: 'Card strategy duel where close-to-21 wins without busting.',
    tags: ['2 players', 'Card strategy'],
    featured: false,
  },
  {
    id: 'number-guess',
    title: 'Number Guess',
    emoji: '🎯',
    description: 'Pick a number, lock it in, and reveal the closest guess.',
    tags: ['2 players', 'Fast rounds'],
    featured: false,
  },
  {
    id: 'dice-duel',
    title: 'Dice Duel',
    emoji: '🎲',
    description: 'Roll two dice each and race for the highest total.',
    tags: ['2 players', 'Quick launch'],
    featured: false,
  },
];

interface GamesCatalogProps {
  onBack?: () => void;
}

export function GamesCatalog({ onBack }: GamesCatalogProps) {
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const { publicKey, isConnected, isConnecting, error } = useWallet();

  const userAddress = publicKey ?? '';

  const handleSelectGame = (gameId: string) => {
    setSelectedGame(gameId);
  };

  const handleBackToLibrary = () => {
    setSelectedGame(null);
  };

  if (selectedGame === 'twenty-one') {
    return (
      <TwentyOneGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToLibrary}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  if (selectedGame === 'number-guess') {
    return (
      <NumberGuessGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToLibrary}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  if (selectedGame === 'dice-duel') {
    return (
      <DiceDuelGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToLibrary}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  if (selectedGame === 'buckshot-roulette') {
    return (
      <BuckshotRouletteGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToLibrary}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  return (
    <div className="library-page">
      <div className="library-header">
        {onBack ? (
          <button className="btn-secondary" onClick={onBack}>
            Back to Studio
          </button>
        ) : null}
        <div className="library-intro">
          <h2>Games Library</h2>
          <p>Choose a template to play now or fork into your own title.</p>
        </div>
      </div>

      {!isConnected && (
        <div className="card wallet-banner">
          {error ? (
            <>
              <h3>Wallet Connection Error</h3>
              <p>{error}</p>
            </>
          ) : (
            <>
              <h3>{isConnecting ? 'Connecting...' : 'Connect a Dev Wallet'}</h3>
              <p>Use the switcher above to auto-connect and swap between demo players.</p>
            </>
          )}
        </div>
      )}

      <div className="games-grid">
        {games.map((game, index) => (
          <button
            key={game.id}
            className={`game-card${game.featured ? ' featured' : ''}`}
            type="button"
            disabled={!isConnected}
            onClick={() => handleSelectGame(game.id)}
            style={{ animationDelay: `${index * 120}ms` }}
          >
            <div className="game-card-header">
              <span className="game-emoji">{game.emoji}</span>
              <span className="game-title">{game.title}</span>
            </div>
            <p className="game-description">{game.description}</p>
            <div className="game-tags">
              {game.tags.map((tag) => (
                <span key={tag} className={`game-tag${tag === 'ZK Enabled' || tag === 'Featured' ? ' featured-tag' : ''}`}>
                  {tag}
                </span>
              ))}
            </div>
            <div className="game-cta">Launch Game</div>
          </button>
        ))}
      </div>

      <section className="zk-section">
        <div className="zk-header">
          <h3>Zero Knowledge Games</h3>
        </div>
        <div className="zk-grid">
          <div className="zk-card">
            <div className="zk-card-text">
              <div className="zk-card-title">TypeZero</div>
              <p className="zk-card-description">
                A typing game built with RISC Zero and Stellar. Requires local setup.
              </p>
              <div className="zk-card-links">
                <a
                  className="zk-card-link"
                  href="https://github.com/jamesbachini/typezero/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open on GitHub
                </a>
                <a
                  className="zk-card-link"
                  href="https://jamesbachini.com/stellar-risc-zero-games/?dpl_token=20623f91-ba93-4bfb-81b4-d7097ef5811f"
                  target="_blank"
                  rel="noreferrer"
                >
                  Tutorial
                </a>
              </div>
            </div>
            <div className="zk-media">
              <img
                src={typezeroHero}
                alt="TypeZero gameplay screenshot"
                loading="lazy"
              />
            </div>
          </div>
          <div className="zk-card">
            <div className="zk-card-text">
              <div className="zk-card-title">XRay Games</div>
              <p className="zk-card-description">
                A series of games including slicer built with Circom circuits.
              </p>
              <div className="zk-card-links">
                <a
                  className="zk-card-link"
                  href="https://github.com/fredericrezeau/xray-games"
                  target="_blank"
                  rel="noreferrer"
                >
                  OPEN ON GITHUB
                </a>
                <a
                  className="zk-card-link"
                  href="https://kyungj.in/posts/trustless-gaming-stellar-xray-games/"
                  target="_blank"
                  rel="noreferrer"
                >
                  TUTORIAL
                </a>
              </div>
            </div>
            <div className="zk-media">
              <img
                src={xrayHero}
                alt="XRay Games gameplay screenshot"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
