import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { buckshotRouletteService, generateZKSeed, hashSeed } from './buckshotRouletteService';
import type { Game, GameStatus } from './bindings';
import { useWallet } from '@/hooks/useWallet';
import './BuckshotRouletteGame.css';

import crosshairSvg from './assets/crosshair.svg';
import healthIconSvg from './assets/health-icon.svg';
import shellLiveSvg from './assets/shell-live.svg';
import shellBlankSvg from './assets/shell-blank.svg';

interface BuckshotRouletteGameProps {
  userAddress: string;
  currentEpoch: number;
  availablePoints: bigint;
  onBack: () => void;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

type GamePhase = 'menu' | 'create' | 'join' | 'waiting' | 'zk_commit' | 'zk_reveal' | 'round_start' | 'playing' | 'game_over';

export function BuckshotRouletteGame({
  userAddress,
  onBack,
  onGameComplete,
}: BuckshotRouletteGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    dealerHead: THREE.Mesh;
    shotgunGroup: THREE.Group;
    ambientLight: THREE.AmbientLight;
  } | null>(null);
  
  const { getContractSigner } = useWallet();
  
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [game, setGame] = useState<Game | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinSessionId, setJoinSessionId] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [lastShotResult, setLastShotResult] = useState<{ isLive: boolean; target: string } | null>(null);
  const [gameOverMsg, setGameOverMsg] = useState<string>('');
  
  // ZK State
  const [mySeed, setMySeed] = useState<Uint8Array | null>(null);
  const [myCommitment, setMyCommitment] = useState<Uint8Array | null>(null);
  const [p1Committed, setP1Committed] = useState(false);
  const [p2Committed, setP2Committed] = useState(false);
  const [p1Revealed, setP1Revealed] = useState(false);
  const [p2Revealed, setP2Revealed] = useState(false);

  const MAX_HEALTH = 4;

  const log = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-20), `> ${msg}`]);
  }, []);
  
  // Load seed from localStorage on mount or session change
  useEffect(() => {
    if (sessionId && userAddress) {
      const storedSeed = localStorage.getItem(`zk_seed_${sessionId}_${userAddress}`);
      const storedCommitment = localStorage.getItem(`zk_commitment_${sessionId}_${userAddress}`);
      
      if (storedSeed) {
        try {
          const seedArray = JSON.parse(storedSeed);
          setMySeed(new Uint8Array(seedArray));
          log('Restored your seed from storage.');
        } catch (e) {
          console.error('Failed to parse stored seed:', e);
        }
      }
      if (storedCommitment) {
        try {
          const commitmentArray = JSON.parse(storedCommitment);
          setMyCommitment(new Uint8Array(commitmentArray));
        } catch (e) {
          console.error('Failed to parse stored commitment:', e);
        }
      }
    }
  }, [sessionId, userAddress, log]);
  
  const isPlayer1 = game?.player1 === userAddress;
  const isPlayer2 = game?.player2 === userAddress;
  const playerHealth = isPlayer1 ? game?.p1_health : game?.p2_health;
  const opponentHealth = isPlayer1 ? game?.p2_health : game?.p1_health;
  
  const isPlayerTurn = game && (
    (game.turn === 1 && isPlayer1) || 
    (game.turn === 2 && isPlayer2)
  );

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    scene.fog = new THREE.Fog(0x050505, 5, 20);

    const camera = new THREE.PerspectiveCamera(75, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 1000);
    camera.position.set(0, 3, 6);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);

    const spotLight = new THREE.SpotLight(0xffffff, 20);
    spotLight.position.set(0, 10, 0);
    spotLight.angle = Math.PI / 6;
    spotLight.penumbra = 0.5;
    spotLight.castShadow = true;
    scene.add(spotLight);

    const tableGeometry = new THREE.BoxGeometry(8, 0.2, 5);
    const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.8 });
    const table = new THREE.Mesh(tableGeometry, tableMaterial);
    table.receiveShadow = true;
    scene.add(table);

    const dealerGroup = new THREE.Group();
    const dealerBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 2, 1),
      new THREE.MeshStandardMaterial({ color: 0x111111 })
    );
    dealerBody.position.y = 1;
    dealerBody.position.z = -2.5;
    dealerGroup.add(dealerBody);

    const dealerHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0x880000, emissive: 0x220000 })
    );
    dealerHead.position.y = 2.4;
    dealerHead.position.z = -2.5;
    dealerGroup.add(dealerHead);
    scene.add(dealerGroup);

    const shotgunGroup = new THREE.Group();
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 3),
      new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 })
    );
    barrel.rotation.x = Math.PI / 2;
    shotgunGroup.add(barrel);
    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.4, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x5c4033 })
    );
    stock.position.z = 1.5;
    shotgunGroup.add(stock);
    shotgunGroup.position.y = 0.3;
    shotgunGroup.rotation.y = Math.PI / 2;
    scene.add(shotgunGroup);

    sceneRef.current = { scene, camera, renderer, dealerHead, shotgunGroup, ambientLight };

    const animate = () => {
      requestAnimationFrame(animate);
      dealerHead.position.y = 2.4 + Math.sin(Date.now() * 0.001) * 0.05;
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  const triggerGunEffect = useCallback((isLive: boolean) => {
    if (!sceneRef.current) return;
    const { scene, camera, shotgunGroup } = sceneRef.current;

    if (isLive) {
      const flash = new THREE.PointLight(0xffaa00, 10, 5);
      flash.position.copy(shotgunGroup.position);
      scene.add(flash);
      setTimeout(() => scene.remove(flash), 100);
      
      const originalCamY = camera.position.y;
      camera.position.y += 0.1;
      setTimeout(() => camera.position.y = originalCamY, 50);
    } else {
      const flash = new THREE.PointLight(0x555555, 2, 2);
      flash.position.copy(shotgunGroup.position);
      scene.add(flash);
      setTimeout(() => scene.remove(flash), 50);
      
      const originalCamY = camera.position.y;
      camera.position.y += 0.02;
      setTimeout(() => camera.position.y = originalCamY, 30);
    }
  }, []);

  const flashDealer = useCallback(() => {
    if (!sceneRef.current) return;
    const { dealerHead, ambientLight } = sceneRef.current;
    const material = dealerHead.material as THREE.MeshStandardMaterial;
    material.color.setHex(0xff0000);
    ambientLight.intensity = 2;
    setTimeout(() => {
      material.color.setHex(0x880000);
      ambientLight.intensity = 0.5;
    }, 200);
  }, []);

  const flashScreen = useCallback(() => {
    if (!sceneRef.current) return;
    const { scene } = sceneRef.current;
    scene.background = new THREE.Color(0x550000);
    setTimeout(() => scene.background = new THREE.Color(0x050505), 100);
  }, []);

  // Check game status from contract
  const checkGameStatus = useCallback(async (sid: number) => {
    const gameState = await buckshotRouletteService.getGame(sid);
    if (!gameState) return null;
    
    setGame(gameState);
    
    // Check ZK status
    const status = gameState.status;
    if (status.tag === 'AwaitingSeeds') {
      // Check commitments
      // Note: We'd need to query individual commitments
    }
    
    return gameState;
  }, []);

  // Create a new game
  const handleCreateGame = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const signer = getContractSigner();
      const newSessionId = Math.floor(Date.now() / 1000);
      
      log('Creating game...');
      await buckshotRouletteService.createGame(newSessionId, userAddress, 100n, signer);
      
      setSessionId(newSessionId);
      log(`Game created! Session ID: ${newSessionId}`);
      log('Waiting for opponent to join...');
      setPhase('waiting');
      
      // Start polling for opponent
      pollForOpponent(newSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
      log('Error: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  // Poll for opponent to join
  const pollForOpponent = async (sid: number) => {
    const poll = async () => {
      const gameState = await buckshotRouletteService.getGame(sid);
      if (gameState && gameState.player2) {
        setGame(gameState);
        log('Opponent joined!');
        log('Now both players must commit their ZK seeds...');
        setPhase('zk_commit');
        return true;
      }
      return false;
    };

    const interval = setInterval(async () => {
      const started = await poll();
      if (started) {
        clearInterval(interval);
      }
    }, 3000);

    poll();
  };

  // Join an existing game
  const handleJoinGame = async () => {
    if (!joinSessionId) {
      setError('Please enter a session ID');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const sid = parseInt(joinSessionId);
      const signer = getContractSigner();
      
      log(`Joining game ${sid}...`);
      await buckshotRouletteService.joinGame(sid, userAddress, 100n, signer);
      
      setSessionId(sid);
      log('Joined! Now both players must commit ZK seeds...');
      setPhase('zk_commit');
      
      const gameState = await buckshotRouletteService.getGame(sid);
      setGame(gameState);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join game');
    } finally {
      setIsLoading(false);
    }
  };

  // ZK Step 1: Commit seed
  const handleCommitSeed = async () => {
    if (!sessionId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const signer = getContractSigner();
      
      // Generate random seed
      const seed = generateZKSeed();
      const commitment = await hashSeed(seed);
      
      log('Generating ZK commitment...');
      
      await buckshotRouletteService.commitSeed(sessionId, userAddress, commitment, signer);
      
      setMySeed(seed);
      setMyCommitment(commitment);
      
      log('ZK seed committed! (Your seed is hidden until reveal)');
      log('Waiting for opponent to commit...');
      
      // Start polling for both committed
      pollForBothCommitted(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to commit seed');
    } finally {
      setIsLoading(false);
    }
  };

  // Poll for both players committed
  const pollForBothCommitted = async (sid: number) => {
    // For simplicity, we'll poll game status
    // In production, you'd query individual commitments
    const interval = setInterval(async () => {
      const gameState = await buckshotRouletteService.getGame(sid);
      if (gameState && gameState.status.tag === 'AwaitingReveal') {
        log('Both players committed! Time to reveal...');
        setPhase('zk_reveal');
        clearInterval(interval);
      }
    }, 2000);
  };

  // ZK Step 2: Reveal seed
  const handleRevealSeed = async () => {
    if (!sessionId) {
      setError('No session ID');
      return;
    }
    
    if (!mySeed) {
      setError('No seed found. Please commit your seed first.');
      log('ERROR: No seed found. You may need to go back and commit again.');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const signer = getContractSigner();
      
      log('Revealing ZK seed...');
      
      await buckshotRouletteService.revealSeed(sessionId, userAddress, mySeed, signer);
      
      log('ZK seed revealed!');
      log('Waiting for opponent to reveal...');
      
      // Poll for both revealed and game finalized
      pollForGameStart(sessionId);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to reveal seed';
      setError(errMsg);
      log('ERROR: ' + errMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // Poll for game to start (both revealed)
  const pollForGameStart = async (sid: number) => {
    const interval = setInterval(async () => {
      const gameState = await buckshotRouletteService.getGame(sid);
      if (gameState && gameState.status.tag === 'InProgress') {
        setGame(gameState);
        log('ZK complete! Shell sequence generated from combined seeds.');
        log(`Round 1: ${gameState.live_count} LIVE, ${gameState.blank_count} BLANK`);
        setPhase('round_start');
        clearInterval(interval);
      } else if (gameState && gameState.status.tag === 'AwaitingReveal') {
        // Both committed but not both revealed yet
        // Check if both have revealed (would need finalize call)
        // For now, let player1 finalize
        if (gameState.player1 === userAddress) {
          try {
            const signer = getContractSigner();
            await buckshotRouletteService.finalizeGameStart(sid, userAddress, signer);
          } catch (e) {
            // Not ready yet, continue polling
          }
        }
      }
    }, 2000);
  };

  // Shoot self
  const handleShootSelf = async () => {
    if (!sessionId || !game) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const signer = getContractSigner();
      log('Shooting self...');
      
      const isLive = await buckshotRouletteService.shootSelf(sessionId, userAddress, signer);
      setLastShotResult({ isLive, target: 'self' });
      
      triggerGunEffect(isLive);
      
      if (isLive) {
        flashScreen();
        log('💥 LIVE! You shot yourself!');
      } else {
        log('💨 BLANK! Extra turn!');
      }
      
      const gameState = await buckshotRouletteService.getGame(sessionId);
      setGame(gameState);
      
      if (gameState?.winner) {
        setGameOverMsg(gameState.winner === userAddress ? 'YOU WIN' : 'YOU DIED');
        setPhase('game_over');
        onGameComplete();
      } else if (gameState?.shells_remaining === 0 && !gameState?.winner) {
        // Start new round
        await buckshotRouletteService.startRound(sessionId, userAddress, signer);
        const newGameState = await buckshotRouletteService.getGame(sessionId);
        setGame(newGameState);
        setPhase('round_start');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to shoot');
    } finally {
      setIsLoading(false);
    }
  };

  // Shoot opponent
  const handleShootOpponent = async () => {
    if (!sessionId || !game) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const signer = getContractSigner();
      log('Shooting opponent...');
      
      const isLive = await buckshotRouletteService.shootOpponent(sessionId, userAddress, signer);
      setLastShotResult({ isLive, target: 'opponent' });
      
      triggerGunEffect(isLive);
      
      if (isLive) {
        flashDealer();
        log('💥 LIVE! Opponent hit!');
      } else {
        log('💨 BLANK! Opponent safe.');
      }
      
      const gameState = await buckshotRouletteService.getGame(sessionId);
      setGame(gameState);
      
      if (gameState?.winner) {
        setGameOverMsg(gameState.winner === userAddress ? 'YOU WIN' : 'YOU DIED');
        setPhase('game_over');
        onGameComplete();
      } else if (gameState?.shells_remaining === 0 && !gameState?.winner) {
        await buckshotRouletteService.startRound(sessionId, userAddress, signer);
        const newGameState = await buckshotRouletteService.getGame(sessionId);
        setGame(newGameState);
        setPhase('round_start');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to shoot');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (lastShotResult) {
      const timer = setTimeout(() => setLastShotResult(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [lastShotResult]);

  // Poll for game state updates when playing
  useEffect(() => {
    if (phase !== 'playing' || !sessionId) return;

    const pollInterval = setInterval(async () => {
      try {
        const gameState = await buckshotRouletteService.getGame(sessionId);
        if (gameState) {
          const prevTurn = game?.turn;
          setGame(gameState);
          
          if (prevTurn !== gameState.turn) {
            const nowMyTurn = (gameState.turn === 1 && gameState.player1 === userAddress) ||
                             (gameState.turn === 2 && gameState.player2 === userAddress);
            if (nowMyTurn) {
              log("It's your turn now!");
            }
          }
          
          if (gameState.winner) {
            setGameOverMsg(gameState.winner === userAddress ? 'YOU WIN' : 'YOU DIED');
            setPhase('game_over');
            onGameComplete();
          }
          
          if (gameState.shells_remaining === 0 && !gameState.winner && gameState.status.tag === 'InProgress') {
            setPhase('round_start');
          }
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [phase, sessionId, userAddress, onGameComplete, game?.turn, log]);

  const renderHealth = (current: number | undefined) => {
    const health = current ?? 0;
    return Array.from({ length: MAX_HEALTH }).map((_, i) => (
      <img 
        key={i} 
        src={healthIconSvg}
        alt="health"
        className={`health-icon ${i >= health ? 'lost' : ''}`}
      />
    ));
  };

  return (
    <div className="buckshot-game-wrapper">
      <div ref={containerRef} className="three-container" />
      <div className="crt-overlay" />

      {/* Main Menu */}
      {phase === 'menu' && (
        <div className="menu-overlay">
          <h1>BUCKSHOT ROULETTE</h1>
          <p className="subtitle">🔐 ZK Commit-Reveal Edition</p>
          <p className="zk-info">Shell sequence generated from combined player seeds</p>
          <div className="menu-buttons">
            <button onClick={() => setPhase('create')} className="btn-enter">
              CREATE GAME
            </button>
            <button onClick={() => setPhase('join')} className="btn-enter secondary">
              JOIN GAME
            </button>
          </div>
          <button onClick={onBack} className="btn-back-menu">
            ← Back to Games
          </button>
        </div>
      )}

      {/* Create Game */}
      {phase === 'create' && (
        <div className="menu-overlay">
          <h2>CREATE GAME</h2>
          <div className="setup-form">
            <label>
              <span>Your Address:</span>
              <input type="text" value={userAddress} disabled />
            </label>
            <label>
              <span>Points to Wager:</span>
              <input type="text" value="100" disabled />
            </label>
            <button onClick={handleCreateGame} disabled={isLoading} className="btn-start">
              {isLoading ? 'Creating...' : 'Create Game'}
            </button>
            <button onClick={() => setPhase('menu')} className="btn-back-menu">
              ← Back
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {/* Join Game */}
      {phase === 'join' && (
        <div className="menu-overlay">
          <h2>JOIN GAME</h2>
          <div className="setup-form">
            <label>
              <span>Your Address:</span>
              <input type="text" value={userAddress} disabled />
            </label>
            <label>
              <span>Session ID:</span>
              <input 
                type="text" 
                value={joinSessionId} 
                onChange={(e) => setJoinSessionId(e.target.value)}
                placeholder="Enter session ID"
              />
            </label>
            <button onClick={handleJoinGame} disabled={isLoading} className="btn-start">
              {isLoading ? 'Joining...' : 'Join Game'}
            </button>
            <button onClick={() => setPhase('menu')} className="btn-back-menu">
              ← Back
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {/* Waiting for Opponent */}
      {phase === 'waiting' && sessionId && (
        <div className="menu-overlay">
          <h2>WAITING FOR OPPONENT</h2>
          <div className="session-info">
            <p>Share this Session ID with your opponent:</p>
            <div className="session-id-display">{sessionId}</div>
            <button 
              onClick={() => navigator.clipboard.writeText(sessionId.toString())}
              className="btn-copy"
            >
              Copy Session ID
            </button>
          </div>
          <p className="waiting-text">Waiting for opponent to join...</p>
          <button onClick={() => setPhase('menu')} className="btn-back-menu">
            Cancel
          </button>
        </div>
      )}

      {/* ZK Commit Phase */}
      {phase === 'zk_commit' && game && (
        <div className="menu-overlay">
          <h2>🔐 ZK STEP 1: COMMIT SEED</h2>
          <div className="zk-info-box">
            <p>Both players must commit a secret seed.</p>
            <p>The seeds will be combined to generate the shell sequence.</p>
            <p>Nobody can predict the shells until both reveal!</p>
          </div>
          
          <div className="zk-status">
            <div className={`zk-player ${myCommitment ? 'committed' : ''}`}>
              <span>YOU</span>
              <span>{myCommitment ? '✅ Committed' : '⏳ Waiting'}</span>
            </div>
            <div className="zk-vs">VS</div>
            <div className={`zk-player opponent ${game.player2 ? '' : 'waiting'}`}>
              <span>OPPONENT</span>
              <span>{game.status?.tag === 'AwaitingReveal' ? '✅ Committed' : '⏳ Waiting'}</span>
            </div>
          </div>
          
          <button 
            onClick={handleCommitSeed} 
            disabled={isLoading || !!myCommitment}
            className="btn-zk"
          >
            {myCommitment ? '✓ Seed Committed' : isLoading ? 'Committing...' : 'Commit My Seed'}
          </button>
          
          {myCommitment && (
            <div className="commitment-display">
              <p>Your commitment (hidden until reveal):</p>
              <code>{Array.from(myCommitment.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')}...</code>
            </div>
          )}
          
          <button 
            onClick={async () => {
              if (sessionId) {
                const gs = await buckshotRouletteService.getGame(sessionId);
                if (gs) {
                  setGame(gs);
                  log(`Status: ${gs.status?.tag}`);
                  if (gs.status?.tag === 'AwaitingReveal') {
                    log('Both players committed! Moving to reveal...');
                    setPhase('zk_reveal');
                  }
                }
              }
            }}
            className="btn-refresh"
          >
            🔄 Refresh Status
          </button>
          
          <button onClick={() => setPhase('menu')} className="btn-back-menu">
            Cancel
          </button>
        </div>
      )}

      {/* ZK Reveal Phase */}
      {phase === 'zk_reveal' && game && (
        <div className="menu-overlay">
          <h2>🔓 ZK STEP 2: REVEAL SEED</h2>
          <div className="zk-info-box">
            <p>Both players have committed their seeds.</p>
            <p>Now reveal your seed to generate the shell sequence!</p>
          </div>
          
          {mySeed ? (
            <>
              <div className="commitment-display">
                <p>Your seed is ready to reveal:</p>
                <code>{Array.from(mySeed.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')}...</code>
              </div>
              <button 
                onClick={handleRevealSeed} 
                disabled={isLoading}
                className="btn-zk reveal"
              >
                {isLoading ? 'Revealing...' : 'Reveal My Seed'}
              </button>
            </>
          ) : (
            <div className="error-box">
              <p>⚠️ No seed found!</p>
              <p>You may have refreshed the page. Please go back and commit again.</p>
              <button onClick={() => setPhase('zk_commit')} className="btn-zk">
                Go Back to Commit
              </button>
            </div>
          )}
          
          {error && <div className="error">{error}</div>}
          
          <button onClick={() => setPhase('menu')} className="btn-back-menu">
            Cancel
          </button>
        </div>
      )}

      {/* Round Start - Contract is source of truth */}
      {phase === 'round_start' && game && (
        <div className="round-notification">
          <h2>ROUND {game.round}</h2>
          <p className="zk-badge">🔐 ZK Verified Shells</p>
          <div className="shell-display">
            {Array.from({ length: game.live_count }).map((_, i) => (
              <div key={`live-${i}`} className="shell-group">
                <img src={shellLiveSvg} alt="Live" className="shell-img" />
                <span className="live-label">LIVE</span>
              </div>
            ))}
            {Array.from({ length: game.blank_count }).map((_, i) => (
              <div key={`blank-${i}`} className="shell-group">
                <img src={shellBlankSvg} alt="Blank" className="shell-img" />
                <span className="blank-label">BLANK</span>
              </div>
            ))}
          </div>
          <p className="shell-total">Total: {game.shells_remaining} shells (from contract)</p>
          <button onClick={() => setPhase('playing')} className="btn-ack">
            READY
          </button>
        </div>
      )}

      {/* Game UI */}
      {phase === 'playing' && game && (
        <div className="game-ui">
          <img src={crosshairSvg} alt="" className="crosshair" />
          
          <div className="stats-bar">
            <div className="health-container">
              <div className="health-label">OPPONENT</div>
              <div className="health-icons">{renderHealth(opponentHealth)}</div>
            </div>
            
            <div className="turn-indicator">
              {isPlayerTurn ? 'YOUR TURN' : 'OPPONENT TURN'}
            </div>
            
            <div className="health-container">
              <div className="health-label">YOU</div>
              <div className="health-icons">{renderHealth(playerHealth)}</div>
            </div>
          </div>

          {lastShotResult && (
            <div className={`shot-result ${lastShotResult.isLive ? 'live' : 'blank'}`}>
              {lastShotResult.isLive ? '💥' : '💨'} 
              {lastShotResult.isLive ? 'LIVE!' : 'BLANK!'}
              {lastShotResult.target === 'self' && !lastShotResult.isLive && ' Extra turn!'}
            </div>
          )}

          <div className="controls-area">
            <div className="log">
              {logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div className="button-group">
              <button 
                onClick={handleShootOpponent} 
                disabled={!isPlayerTurn || isLoading}
              >
                🎯 SHOOT OPPONENT
              </button>
              <button 
                onClick={handleShootSelf} 
                disabled={!isPlayerTurn || isLoading}
              >
                🔫 SHOOT SELF
              </button>
            </div>
            <div className="game-info">
              Round: {game.round} | Shells: {game.shells_remaining} | 🔐 ZK
            </div>
          </div>
          
          {error && <div className="error-toast">{error}</div>}
        </div>
      )}

      {/* Game Over */}
      {phase === 'game_over' && (
        <div className="menu-overlay game-over">
          <h1 style={{ color: gameOverMsg === 'YOU WIN' ? '#33ff33' : '#ff3333' }}>
            {gameOverMsg}
          </h1>
          <p className="zk-badge">🔐 Verified on-chain with ZK commit-reveal</p>
          <button onClick={() => {
            setPhase('menu');
            setGame(null);
            setSessionId(null);
            setLogs([]);
            setMySeed(null);
            setMyCommitment(null);
          }} className="btn-restart">
            PLAY AGAIN
          </button>
          <button onClick={onBack} className="btn-back-menu">
            BACK TO GAMES
          </button>
        </div>
      )}
    </div>
  );
}
