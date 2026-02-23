import { useState } from 'react';
import { BuckshotRouletteGame } from '../games/buckshot-roulette/BuckshotRouletteGame';
import { useWallet } from '@/hooks/useWallet';
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

    </div>
  );
}
