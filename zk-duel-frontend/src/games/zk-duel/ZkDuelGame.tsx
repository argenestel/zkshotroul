import { useState, useEffect, useRef, useCallback } from 'react';
import { ZkDuelService } from './zkDuelService';
import { useWallet } from '@/hooks/useWallet';
import { ZK_DUEL_CONTRACT } from '@/utils/constants';
import { getFundedSimulationSourceAddress } from '@/utils/simulationUtils';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import type { Game } from './bindings';
import { Buffer } from 'buffer';
import { keccak256 } from 'js-sha3';

// ============================================================================
// ICONS & ASSETS (Clean Style)
// ============================================================================

const RockIcon = ({ className = "w-12 h-12" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
);

const PaperIcon = ({ className = "w-12 h-12" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
    <path d="M7 7h10" />
    <path d="M7 12h10" />
    <path d="M7 17h10" />
  </svg>
);

const ScissorsIcon = ({ className = "w-12 h-12" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
);

const SawIcon = ({ className = "w-8 h-8" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 12l2-4" />
    <path d="M12 12l-2 4" />
    <path d="M12 12l4 2" />
  </svg>
);

const ShieldIcon = ({ className = "w-8 h-8" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const HeartIcon = ({ filled = true, className = "w-6 h-6" }) => (
  <svg className={`${className} ${filled ? 'text-red-500 fill-red-500' : 'text-gray-300'}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

const Spinner = () => (
  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
);

// ============================================================================
// GAME LOGIC HELPERS
// ============================================================================

const createRandomSessionId = (): number => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    let value = 0;
    const buffer = new Uint32Array(1);
    while (value === 0) {
      crypto.getRandomValues(buffer);
      value = buffer[0];
    }
    return value;
  }
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
};

const getSaltKey = (sessionId: number, turn: number) => `zk-duel-salt-${sessionId}-${turn}`;
const saveSalt = (sessionId: number, turn: number, salt: Buffer, move: number, item: number) => {
  localStorage.setItem(getSaltKey(sessionId, turn), JSON.stringify({ salt: salt.toString('hex'), move, item }));
};
const getSavedMove = (sessionId: number, turn: number) => {
  const data = localStorage.getItem(getSaltKey(sessionId, turn));
  if (!data) return null;
  const parsed = JSON.parse(data);
  return { salt: Buffer.from(parsed.salt, 'hex'), move: parsed.move, item: parsed.item };
};

// Retry helper to poll for state updates
const waitForGame = async (sessionId: number, condition?: (game: Game) => boolean, timeoutMs = 15000): Promise<Game> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const game = await zkDuelService.getGame(sessionId);
      if (game && (!condition || condition(game))) {
        return game;
      }
    } catch (e) { /* ignore 404 */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error("Game state update timed out. Please refresh.");
};

const zkDuelService = new ZkDuelService(ZK_DUEL_CONTRACT);

interface ZkDuelGameProps {
  userAddress: string;
  availablePoints: bigint;
  currentEpoch?: number;
  initialXDR?: string | null;
  initialSessionId?: number | null;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ZkDuelGame({ userAddress, availablePoints, onStandingsRefresh, onGameComplete }: ZkDuelGameProps) {
  const { getContractSigner, walletType } = useWallet();
  
  // State
  const [sessionId, setSessionId] = useState<number>(() => createRandomSessionId());
  const [gameState, setGameState] = useState<Game | null>(null);
  const [activeTab, setActiveTab] = useState<'quick' | 'host' | 'join'>('quick');
  
  // Inputs
  const [points, setPoints] = useState('0.1');
  const [inviteCode, setInviteCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  
  // Play State
  const [selectedMove, setSelectedMove] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<number>(0);
  
  // UI
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const actionLock = useRef(false);
  const quickstartAvailable = walletType === 'dev' && DevWalletService.isDevModeAvailable();

  const runAction = useCallback(async (action: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    try { await action(); } finally { actionLock.current = false; }
  }, []);

  // Polling Game State
  const fetchState = useCallback(async () => {
    try {
      const game = await zkDuelService.getGame(sessionId);
      if (game) setGameState(game);
    } catch (e) {
      // Game might not exist yet
    }
  }, [sessionId]);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, [fetchState]);

  // --------------------------------------------------------------------------
  // ACTIONS
  // --------------------------------------------------------------------------

  const handleQuickStart = async () => {
    await runAction(async () => {
      try {
        setLoading(true); setStatus('Initializing Dev Wallets...'); setError(null);
        const pt = BigInt(Math.floor(parseFloat(points) * 10_000_000));
        const newSid = createRandomSessionId();
        
        await devWalletService.initPlayer(1);
        const p1 = devWalletService.getPublicKey();
        const p1Signer = devWalletService.getSigner();
        
        await devWalletService.initPlayer(2);
        const p2 = devWalletService.getPublicKey();
        const p2Signer = devWalletService.getSigner();
        
        setStatus('Preparing Transaction...');
        // Use p2 directly since we have it (Quickstart)
        const auth = await zkDuelService.prepareStartGame(newSid, p1, p2, pt, pt, p1Signer);
        
        setStatus('Finalizing Setup...');
        const txXdr = await zkDuelService.importAndSignAuthEntry(auth, p2, pt, p2Signer);
        await zkDuelService.finalizeStartGame(txXdr, p2, p2Signer);
        
        setStatus('Waiting for Network...');
        // CRITICAL FIX: Wait for game to exist before switching state
        const game = await waitForGame(newSid);
        
        setSessionId(newSid);
        setGameState(game);
        onStandingsRefresh();
        setStatus('');
      } catch (err: any) { setError(err.message); } finally { setLoading(false); }
    });
  };

  const handleHost = async () => {
    await runAction(async () => {
      try {
        setLoading(true); setError(null);
        const pt = BigInt(Math.floor(parseFloat(points) * 10_000_000));
        const signer = getContractSigner();
        const placeholder = await getFundedSimulationSourceAddress([userAddress]);
        
        const auth = await zkDuelService.prepareStartGame(sessionId, userAddress, placeholder, pt, pt, signer);
        setInviteCode(auth);
        setStatus('Invite Code Generated. Waiting for Player 2...');
        
        // Wait until game exists on chain (Player 2 joins)
        const game = await waitForGame(sessionId, (g) => !!g, 300000); // 5 min timeout
        setGameState(game);
        setStatus('');
      } catch (err: any) { setError(err.message); } finally { setLoading(false); }
    });
  };

  const handleJoin = async () => {
    if (!joinCode) return setError("Enter invite code");
    await runAction(async () => {
      try {
        setLoading(true); setError(null);
        const pt = BigInt(Math.floor(parseFloat(points) * 10_000_000));
        const signer = getContractSigner();
        
        // Extract session ID from code
        const params = zkDuelService.parseAuthEntry(joinCode);
        setSessionId(params.sessionId);
        
        setStatus('Signing & Submitting...');
        const txXdr = await zkDuelService.importAndSignAuthEntry(joinCode, userAddress, pt, signer);
        await zkDuelService.finalizeStartGame(txXdr, userAddress, signer);
        
        setStatus('Waiting for Network...');
        const game = await waitForGame(params.sessionId);
        setGameState(game);
        onStandingsRefresh();
        setStatus('');
      } catch (err: any) { setError(err.message); } finally { setLoading(false); }
    });
  };

  const handleCommit = async () => {
    if (selectedMove === null) return setError("Select a move");
    await runAction(async () => {
      try {
        setLoading(true); setError(null);
        const salt = Buffer.alloc(32);
        crypto.getRandomValues(salt);
        
        const moveBuf = Buffer.alloc(4); moveBuf.writeUInt32BE(selectedMove);
        const itemBuf = Buffer.alloc(4); itemBuf.writeUInt32BE(selectedItem);
        const hash = Buffer.from(keccak256(Buffer.concat([moveBuf, itemBuf, salt])), 'hex');
        
        const signer = getContractSigner();
        await zkDuelService.commitMove(sessionId, userAddress, hash, signer);
        saveSalt(sessionId, gameState!.turn, salt, selectedMove, selectedItem);
        
        setStatus('Verifying Commit...');
        await waitForGame(sessionId, (g) => {
            const me = g.player1 === userAddress ? g.p1_commit : g.p2_commit;
            return !!me; // Wait until my commit is visible
        });
        
        setSelectedMove(null); setSelectedItem(0);
        setStatus('');
      } catch (err: any) { setError(err.message); } finally { setLoading(false); }
    });
  };

  const handleReveal = async () => {
    await runAction(async () => {
      try {
        setLoading(true); setError(null);
        const saved = getSavedMove(sessionId, gameState!.turn);
        if (!saved) throw new Error("Move secret not found on this device.");
        
        const signer = getContractSigner();
        await zkDuelService.revealMove(sessionId, userAddress, saved.move, saved.item, saved.salt, signer);
        
        setStatus('Verifying Reveal...');
        await waitForGame(sessionId, (g) => {
            const me = g.player1 === userAddress ? g.p1_revealed_move : g.p2_revealed_move;
            return me !== 0; // Wait until revealed
        });
        setStatus('');
      } catch (err: any) { setError(err.message); } finally { setLoading(false); }
    });
  };

  // --------------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------------

  // Derived State
  const isP1 = gameState?.player1 === userAddress;
  const myHealth = gameState ? (isP1 ? gameState.p1_health : gameState.p2_health) : 3;
  const oppHealth = gameState ? (isP1 ? gameState.p2_health : gameState.p1_health) : 3;
  const myCommit = gameState ? (isP1 ? gameState.p1_commit : gameState.p2_commit) : null;
  const oppCommit = gameState ? (isP1 ? gameState.p2_commit : gameState.p1_commit) : null;
  const myRevealed = gameState ? (isP1 ? gameState.p1_revealed_move : gameState.p2_revealed_move) : 0;
  
  // Game Phase Logic
  let phase = 'setup';
  if (gameState) {
    if (gameState.winner) phase = 'complete';
    else if (myCommit && oppCommit && !myRevealed) phase = 'reveal';
    else phase = 'play';
  }

  return (
    <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100 font-sans">
      
      {/* HEADER */}
      <div className="bg-gray-50 border-b border-gray-200 p-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">ZK Duel</h1>
          <p className="text-sm text-gray-500 font-medium">Session: {sessionId} • {phase.toUpperCase()}</p>
        </div>
        {gameState && (
          <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200">
            <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Turn</span>
            <span className="ml-2 text-xl font-bold text-gray-800">{gameState.turn}</span>
          </div>
        )}
      </div>

      {/* ERROR / STATUS */}
      {error && <div className="bg-red-50 text-red-600 px-6 py-3 text-sm font-medium border-b border-red-100">{error}</div>}
      {status && <div className="bg-blue-50 text-blue-600 px-6 py-3 text-sm font-medium border-b border-blue-100 flex items-center gap-2"><Spinner/> {status}</div>}

      <div className="p-8">
        
        {/* PHASE: SETUP */}
        {phase === 'setup' && (
          <div className="space-y-8">
            <div className="flex gap-4 border-b border-gray-200">
              {['quick', 'host', 'join'].map(t => (
                <button 
                  key={t}
                  onClick={() => setActiveTab(t as any)}
                  className={`pb-3 px-4 text-sm font-bold uppercase tracking-wider transition-colors ${activeTab === t ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {t} Start
                </button>
              ))}
            </div>

            {activeTab === 'quick' && quickstartAvailable && (
              <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
                <h3 className="text-lg font-bold text-blue-900 mb-2">Developer Quickstart</h3>
                <p className="text-blue-700 text-sm mb-6">Auto-generates a game between two funded dev wallets.</p>
                <div className="flex gap-4 items-end">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Points</label>
                    <input type="text" value={points} onChange={e => setPoints(e.target.value)} className="w-full p-3 rounded-lg border border-blue-200 focus:ring-2 focus:ring-blue-500 outline-none"/>
                  </div>
                  <button onClick={handleQuickStart} disabled={loading} className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-lg shadow-blue-200 transition-all">
                    {loading ? 'Initializing...' : 'Launch Game'}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'host' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Wager (XLM)</label>
                  <input type="text" value={points} onChange={e => setPoints(e.target.value)} className="w-full p-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none"/>
                </div>
                {inviteCode ? (
                  <div className="bg-gray-100 p-4 rounded-lg break-all font-mono text-xs border border-gray-300">
                    {inviteCode}
                  </div>
                ) : (
                  <button onClick={handleHost} disabled={loading} className="w-full py-4 bg-gray-900 text-white rounded-xl font-bold shadow-lg hover:bg-black transition-all">
                    {loading ? 'Generating Code...' : 'Generate Invite Code'}
                  </button>
                )}
              </div>
            )}

            {activeTab === 'join' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Paste Invite Code</label>
                  <textarea value={joinCode} onChange={e => setJoinCode(e.target.value)} className="w-full h-32 p-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none font-mono text-xs"/>
                </div>
                <button onClick={handleJoin} disabled={loading} className="w-full py-4 bg-gray-900 text-white rounded-xl font-bold shadow-lg hover:bg-black transition-all">
                  {loading ? 'Joining...' : 'Join Game'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* PHASE: PLAY & REVEAL */}
        {(phase === 'play' || phase === 'reveal') && (
          <div className="space-y-12">
            
            {/* HEALTH BARS */}
            <div className="flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <div className="text-center">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">You</p>
                <div className="flex gap-1">
                  {[...Array(3)].map((_, i) => <HeartIcon key={i} filled={i < myHealth} />)}
                </div>
              </div>
              <div className="text-2xl font-black text-gray-200 italic">VS</div>
              <div className="text-center">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Opponent</p>
                <div className="flex gap-1">
                  {[...Array(3)].map((_, i) => <HeartIcon key={i} filled={i < oppHealth} />)}
                </div>
              </div>
            </div>

            {/* ACTION: PLAY */}
            {phase === 'play' && !myCommit && (
              <div className="space-y-8">
                <div>
                  <h3 className="text-center text-sm font-bold text-gray-400 uppercase mb-4">Select Move</h3>
                  <div className="flex justify-center gap-4">
                    {[
                      { id: 1, label: 'Rock', Icon: RockIcon },
                      { id: 2, label: 'Paper', Icon: PaperIcon },
                      { id: 3, label: 'Scissors', Icon: ScissorsIcon }
                    ].map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setSelectedMove(m.id)}
                        className={`flex flex-col items-center p-6 rounded-2xl border-2 transition-all w-32 ${
                          selectedMove === m.id 
                            ? 'border-blue-500 bg-blue-50 text-blue-600 shadow-lg shadow-blue-100 scale-105' 
                            : 'border-gray-100 bg-white text-gray-400 hover:border-gray-300'
                        }`}
                      >
                        <m.Icon className="w-10 h-10 mb-2"/>
                        <span className="font-bold text-sm uppercase">{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-center text-sm font-bold text-gray-400 uppercase mb-4">Select Item</h3>
                  <div className="flex justify-center gap-4">
                    {[
                      { id: 0, label: 'None', Icon: null },
                      { id: 1, label: 'Saw', Icon: SawIcon },
                      { id: 3, label: 'Shield', Icon: ShieldIcon }
                    ].map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setSelectedItem(m.id)}
                        className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl border-2 transition-all ${
                          selectedItem === m.id 
                            ? 'border-orange-500 bg-orange-50 text-orange-600 shadow-md' 
                            : 'border-gray-100 bg-white text-gray-400 hover:border-gray-300'
                        }`}
                      >
                        {m.Icon && <m.Icon className="w-5 h-5"/>}
                        <span className="font-bold text-sm uppercase">{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={handleCommit}
                  disabled={loading || !selectedMove}
                  className="w-full py-4 bg-gray-900 hover:bg-black text-white rounded-xl font-bold shadow-xl transition-all disabled:opacity-50 disabled:shadow-none"
                >
                  {loading ? 'Committing...' : 'Lock In Move'}
                </button>
              </div>
            )}

            {/* STATE: WAITING */}
            {phase === 'play' && myCommit && !oppCommit && (
              <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-100 border-dashed">
                <Spinner/>
                <p className="mt-4 font-bold text-gray-600">Waiting for opponent...</p>
                <p className="text-sm text-gray-400">Your move is encrypted and on-chain.</p>
              </div>
            )}

            {/* ACTION: REVEAL */}
            {phase === 'reveal' && (
              <div className="text-center py-8">
                <div className="inline-block p-4 bg-yellow-50 rounded-full mb-6 animate-bounce">
                  <span className="text-4xl">⚔️</span>
                </div>
                <h2 className="text-2xl font-black text-gray-900 mb-2">Showdown!</h2>
                <p className="text-gray-500 mb-8">Both players have committed. Time to reveal.</p>
                <button 
                  onClick={handleReveal}
                  disabled={loading}
                  className="px-12 py-4 bg-yellow-500 hover:bg-yellow-600 text-white rounded-xl font-bold shadow-lg shadow-yellow-200 transition-all"
                >
                  {loading ? 'Verifying...' : 'Reveal Hand'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* PHASE: COMPLETE */}
        {phase === 'complete' && gameState && (
          <div className="text-center py-12">
            <div className="mb-6">
              {gameState.winner === userAddress ? (
                <>
                  <span className="text-6xl block mb-4">🏆</span>
                  <h2 className="text-4xl font-black text-gray-900 mb-2">Victory!</h2>
                  <p className="text-green-600 font-bold">You won the duel.</p>
                </>
              ) : (
                <>
                  <span className="text-6xl block mb-4">💀</span>
                  <h2 className="text-4xl font-black text-gray-900 mb-2">Defeat</h2>
                  <p className="text-red-500 font-bold">Better luck next time.</p>
                </>
              )}
            </div>
            <button 
              onClick={() => { setGameState(null); setSessionId(createRandomSessionId()); onGameComplete(); }}
              className="px-8 py-3 bg-gray-100 hover:bg-gray-200 text-gray-900 rounded-lg font-bold"
            >
              Start New Game
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
