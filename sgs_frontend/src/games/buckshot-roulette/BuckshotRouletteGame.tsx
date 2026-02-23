import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { buckshotRouletteService } from './buckshotRouletteService';
import type { Game } from './bindings';
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

type GamePhase = 'menu' | 'create' | 'join' | 'waiting' | 'round_start' | 'playing' | 'game_over';

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
  const [roundInfo, setRoundInfo] = useState<{ live: number; blank: number; total: number } | null>(null);
  const [gameOverMsg, setGameOverMsg] = useState<string>('');

  const MAX_HEALTH = 4;
  
  // Fix player detection - player2 is Option<Address>
  const isPlayer1 = game?.player1 === userAddress;
  const isPlayer2 = game?.player2 === userAddress;
  const playerHealth = isPlayer1 ? game?.p1_health : game?.p2_health;
  const opponentHealth = isPlayer1 ? game?.p2_health : game?.p1_health;
  
  // Fix turn detection - check if it's the current player's turn
  const isPlayerTurn = game && (
    (game.turn === 1 && isPlayer1) || 
    (game.turn === 2 && isPlayer2)
  );

  const log = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-20), `> ${msg}`]);
  }, []);

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
        log('Opponent joined! Starting game...');
        
        // Start the game
        const signer = getContractSigner();
        await buckshotRouletteService.startGame(sid, userAddress, signer);
        await buckshotRouletteService.startRound(sid, userAddress, signer);
        
        const shellCounts = calculateShellCounts(sid, 1);
        setRoundInfo(shellCounts);
        setPhase('round_start');
        return true;
      }
      return false;
    };

    // Poll every 3 seconds
    const interval = setInterval(async () => {
      const started = await poll();
      if (started) {
        clearInterval(interval);
      }
    }, 3000);

    // Initial check
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
      log('Joined! Starting game...');
      
      // Start the game
      await buckshotRouletteService.startGame(sid, userAddress, signer);
      await buckshotRouletteService.startRound(sid, userAddress, signer);
      
      const gameState = await buckshotRouletteService.getGame(sid);
      setGame(gameState);
      
      const shellCounts = calculateShellCounts(sid, gameState?.round || 1);
      setRoundInfo(shellCounts);
      setPhase('round_start');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join game');
    } finally {
      setIsLoading(false);
    }
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
      } else if (gameState?.shells_remaining === 0) {
        await buckshotRouletteService.startRound(sessionId, userAddress, signer);
        const shellCounts = calculateShellCounts(sessionId, gameState?.round || 1);
        setRoundInfo(shellCounts);
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
      } else if (gameState?.shells_remaining === 0) {
        await buckshotRouletteService.startRound(sessionId, userAddress, signer);
        const shellCounts = calculateShellCounts(sessionId, gameState?.round || 1);
        setRoundInfo(shellCounts);
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
          
          // Log turn change
          if (prevTurn !== gameState.turn) {
            const nowMyTurn = (gameState.turn === 1 && gameState.player1 === userAddress) ||
                             (gameState.turn === 2 && gameState.player2 === userAddress);
            if (nowMyTurn) {
              log("It's your turn now!");
            }
          }
          
          // Check for game over
          if (gameState.winner) {
            setGameOverMsg(gameState.winner === userAddress ? 'YOU WIN' : 'YOU DIED');
            setPhase('game_over');
            onGameComplete();
          }
          
          // Check for new round
          if (gameState.shells_remaining === 0 && !gameState.winner) {
            const shellCounts = calculateShellCounts(sessionId, gameState.round);
            setRoundInfo(shellCounts);
            setPhase('round_start');
          }
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 2000); // Poll every 2 seconds

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

  // Calculate live/blank counts deterministically based on session_id and round
  const calculateShellCounts = useCallback((sid: number, round: number) => {
    // Simple deterministic calculation matching contract pattern
    const seed = sid + round * 1000;
    const total = 2 + (seed % 5); // 2-6 shells
    const live = 1 + (Math.floor(seed / 7) % Math.floor(total / 2)); // 1 to half
    const blank = total - live;
    return { live, blank, total };
  }, []);

  return (
    <div className="buckshot-game-wrapper">
      <div ref={containerRef} className="three-container" />
      <div className="crt-overlay" />

      {/* Main Menu */}
      {phase === 'menu' && (
        <div className="menu-overlay">
          <h1>BUCKSHOT ROULETTE</h1>
          <p className="subtitle">On-Chain Edition</p>
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

      {/* Game UI */}
      {(phase === 'playing' || phase === 'round_start') && game && (
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

          {phase === 'round_start' && roundInfo && (
            <div className="round-notification">
              <h2>ROUND {game.round}</h2>
              <div className="shell-display">
                {Array.from({ length: roundInfo.live }).map((_, i) => (
                  <div key={`live-${i}`} className="shell-group">
                    <img src={shellLiveSvg} alt="Live" className="shell-img" />
                    <span className="live-label">LIVE</span>
                  </div>
                ))}
                {Array.from({ length: roundInfo.blank }).map((_, i) => (
                  <div key={`blank-${i}`} className="shell-group">
                    <img src={shellBlankSvg} alt="Blank" className="shell-img" />
                    <span className="blank-label">BLANK</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setPhase('playing')} className="btn-ack">
                OK
              </button>
            </div>
          )}

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
              Round: {game.round} | Shells: {game.shells_remaining}
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
          <button onClick={() => {
            setPhase('menu');
            setGame(null);
            setSessionId(null);
            setLogs([]);
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
