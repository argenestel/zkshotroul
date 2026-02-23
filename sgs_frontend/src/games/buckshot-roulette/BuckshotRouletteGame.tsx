import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
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
    dealerHead: THREE.Group | THREE.Mesh;
    p1Gun: THREE.Group;
    p2Gun: THREE.Group;
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
  const [opponentCommitted, setOpponentCommitted] = useState(false);

  const MAX_HEALTH = 4;

  const log = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-20), `> ${msg}`]);
  }, []);

  // Helper to get status tag from GameStatus (handles both object and string)
  const getStatusTag = useCallback((status: any): string => {
    if (typeof status === 'string') return status;
    if (status && status.tag) return status.tag;
    return 'Unknown';
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

  // --- Background Ambiance (Web Audio API Drone) ---
  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    let osc1: OscillatorNode, osc2: OscillatorNode, lfo: OscillatorNode;
    let gainNode: GainNode;

    const initAudio = () => {
      if (audioCtx) return;
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Drone 1: Very low sub bass (Sine)
      osc1 = audioCtx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 55;

      // Drone 2: Slightly detuned (Triangle) for an eerie beating effect
      osc2 = audioCtx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 55.5;

      // Filter to muffle it and make it sound like it's coming from outside a room
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 200;

      // LFO for slow volume swelling (creates a breathing/pulsing atmospheric sound)
      lfo = audioCtx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.1; // 10 second cycle

      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 0.03; // Much lower LFO intensity
      lfo.connect(lfoGain);

      gainNode = audioCtx.createGain();
      gainNode.gain.value = 0.05; // Much lower base volume

      // Connect LFO to gain
      lfoGain.connect(gainNode.gain);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc1.start();
      osc2.start();
      lfo.start();
    };

    const handleInteraction = () => {
      initAudio();
      if (audioCtx?.state === 'suspended') {
        audioCtx.resume();
      }
    };

    document.addEventListener('click', handleInteraction, { once: true });

    return () => {
      document.removeEventListener('click', handleInteraction);
      if (audioCtx) {
        audioCtx.close();
      }
    };
  }, []);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    // --- Scene Setup ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020202);
    scene.fog = new THREE.FogExp2(0x020202, 0.08);

    const camera = new THREE.PerspectiveCamera(65, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 100);
    camera.position.set(0, 2.5, 4.5);
    camera.lookAt(0, 1.2, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Removed outputEncoding as it's deprecated in newer Three.js, color space is managed automatically
    containerRef.current.appendChild(renderer.domElement);

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0x333344, 0.5); // Brighter ambient
    scene.add(ambientLight);

    // Interrogation lamp shining straight down on the table
    const spotLight = new THREE.SpotLight(0xffeedd, 90, 30, Math.PI / 4, 0.4, 1);
    spotLight.position.set(0, 7, -1);
    spotLight.target.position.set(0, 0, -1);
    spotLight.castShadow = true;
    spotLight.shadow.mapSize.width = 1024;
    spotLight.shadow.mapSize.height = 1024;
    scene.add(spotLight);
    scene.add(spotLight.target);

    // --- Environment ---
    // Table
    const tableGroup = new THREE.Group();
    const tableTop = new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.1, 4),
      new THREE.MeshStandardMaterial({
        color: 0x2a1e12,
        roughness: 0.9,
        metalness: 0.1,
      })
    );
    tableTop.position.y = 0;
    tableTop.receiveShadow = true;
    tableGroup.add(tableTop);

    // Table Rim
    const tableRim = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 0.2, 4.2),
      new THREE.MeshStandardMaterial({ color: 0x1a120a, roughness: 1 })
    );
    tableRim.position.y = -0.05;
    tableRim.receiveShadow = true;
    tableGroup.add(tableRim);
    scene.add(tableGroup);

    // Lamp Shade
    const lampGeo = new THREE.ConeGeometry(0.8, 1, 16);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.2 });
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(0, 6.5, -1);
    scene.add(lamp);

    // --- Dealer (Menacing Figure) ---
    const dealerGroup = new THREE.Group();
    dealerGroup.position.set(0, 0.1, -2.5);

    // Shoulders/Chest
    const chest = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.7, 1.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 })
    );
    chest.position.y = 0.9;
    chest.castShadow = true;
    dealerGroup.add(chest);

    // Neck
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.25, 0.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x111111 })
    );
    neck.position.y = 1.9;
    dealerGroup.add(neck);

    // Skull / Mask Head
    const headGroup = new THREE.Group();
    headGroup.position.y = 2.4;

    const skullBase = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.5, 1),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.3, roughness: 0.7 })
    );
    skullBase.castShadow = true;
    headGroup.add(skullBase);

    // Glowing Eyes
    const eyeGeo = new THREE.PlaneGeometry(0.15, 0.05);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.2, 0.1, 0.46);
    leftEye.rotation.y = -0.2;
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.2, 0.1, 0.46);
    rightEye.rotation.y = 0.2;
    headGroup.add(leftEye, rightEye);

    // Jaw
    const jaw = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.3, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x151515 })
    );
    jaw.position.set(0, -0.3, 0.1);
    headGroup.add(jaw);

    dealerGroup.add(headGroup);
    scene.add(dealerGroup);

    // --- Shotguns ---
    const createShotgun = () => {
      const group = new THREE.Group();
      const gunMetalMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.4 });
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x3d2314, metalness: 0.1, roughness: 0.8 });

      // Barrel
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 12), gunMetalMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.15, 0);
      barrel.castShadow = true;
      group.add(barrel);

      // Magazine Tube (under barrel)
      const magTube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.8, 12), gunMetalMat);
      magTube.rotation.x = Math.PI / 2;
      magTube.position.set(0, 0.05, 0.35);
      magTube.castShadow = true;
      group.add(magTube);

      // Pump Handle (Ribbed wood)
      const pumpHandle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8),
        woodMat
      );
      pumpHandle.rotation.x = Math.PI / 2;
      pumpHandle.position.set(0, 0.05, 0.2);
      pumpHandle.castShadow = true;
      group.add(pumpHandle);

      // Receiver (Body of the gun)
      const receiver = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.25, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.3 })
      );
      receiver.position.set(0, 0.1, 1.5);
      receiver.castShadow = true;
      group.add(receiver);

      // Trigger Guard
      const guard = new THREE.Mesh(
        new THREE.TorusGeometry(0.06, 0.015, 8, 16, Math.PI),
        gunMetalMat
      );
      guard.rotation.y = Math.PI / 2;
      guard.position.set(0, -0.05, 1.7);
      group.add(guard);

      // Stock
      const stock = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.12, 1.2, 8),
        woodMat
      );
      stock.rotation.x = Math.PI / 2 + 0.1; // Angled down slightly
      stock.position.set(0, 0.0, 2.4);
      stock.castShadow = true;
      group.add(stock);

      return group;
    };

    const p1Gun = createShotgun();
    // First person view: bottom right
    p1Gun.position.set(0.6, 1.5, 3.8);
    p1Gun.rotation.y = Math.PI; // point away from us
    p1Gun.rotation.x = -0.1; // point slightly down towards table
    scene.add(p1Gun);

    const p2Gun = createShotgun();
    // Opponent view: on the table near dealer, pointing towards us slightly
    p2Gun.position.set(-1.0, 0.3, -1.0);
    p2Gun.rotation.y = -0.2;
    scene.add(p2Gun);

    sceneRef.current = { scene, camera, renderer, dealerHead: headGroup, p1Gun, p2Gun, ambientLight };

    // --- Post-Processing (CRT Effect) ---
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    // Custom CRT Shader
    const crtShader = {
      uniforms: {
        tDiffuse: { value: null },
        time: { value: 0 },
        resolution: { value: new THREE.Vector2() }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float time;
        uniform vec2 resolution;
        varying vec2 vUv;

        // Barrel distortion
        vec2 barrelDistortion(vec2 coord, float amt) {
          vec2 cc = coord - 0.5;
          float dist = dot(cc, cc);
          return coord + cc * dist * amt;
        }

        void main() {
          vec2 uv = barrelDistortion(vUv, 0.15); // Curve screen edges

          // Out of bounds check for curved screen
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
          }

          // Chromatic aberration
          float offset = 0.003;
          float r = texture2D(tDiffuse, uv + vec2(offset, 0.0)).r;
          float g = texture2D(tDiffuse, uv).g;
          float b = texture2D(tDiffuse, uv - vec2(offset, 0.0)).b;

          vec4 texColor = vec4(r, g, b, 1.0);

          // Scanlines
          float scanline = sin(uv.y * resolution.y * 0.5) * 0.04;
          texColor.rgb -= scanline;

          // Subtle noise
          float noise = fract(sin(dot(uv, vec2(12.9898, 78.233)) + time) * 43758.5453) * 0.03;
          texColor.rgb += noise;

          // Vignette
          float vignette = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
          vignette = clamp(pow(vignette * 15.0, 0.2), 0.0, 1.0);
          texColor.rgb *= vignette;

          gl_FragColor = texColor;
        }
      `
    };

    const crtPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(crtShader.uniforms),
        vertexShader: crtShader.vertexShader,
        fragmentShader: crtShader.fragmentShader
      })
    );
    composer.addPass(crtPass);

    const animate = () => {
      requestAnimationFrame(animate);

      const time = Date.now() * 0.001;

      // Dealer breathing animation
      dealerGroup.position.y = 0.1 + Math.sin(time * 2) * 0.02;
      headGroup.rotation.y = Math.sin(time * 0.5) * 0.1;
      headGroup.rotation.z = Math.cos(time * 0.3) * 0.05;

      // Update shader uniforms
      if (crtPass.material.uniforms) {
        crtPass.material.uniforms.time.value = time;
        crtPass.material.uniforms.resolution.value.set(
          containerRef.current?.clientWidth || 800,
          containerRef.current?.clientHeight || 600
        );
      }

      composer.render();
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      composer.dispose();
      renderer.dispose();
    };
  }, []);

  const triggerGunEffect = useCallback((isLive: boolean, isPlayerFiring: boolean = true) => {
    if (!sceneRef.current) return;
    const { scene, camera, p1Gun, p2Gun } = sceneRef.current;
    const activeGun = isPlayerFiring ? p1Gun : p2Gun;

    // — Shotgun recoil animation —
    const recoilDistance = isLive ? 0.6 : 0.2;
    const origZ = activeGun.position.z;
    let recoilFrame = 0;
    const recoilFrames = isLive ? 20 : 12;

    const animateRecoil = () => {
      recoilFrame++;
      const t = recoilFrame / recoilFrames;
      // Quick backward, slow return (ease-out spring)
      const ease = t < 0.3
        ? (t / 0.3) * recoilDistance   // fast backward
        : recoilDistance * (1 - ((t - 0.3) / 0.7)) * Math.cos((t - 0.3) * 4); // spring back

      // If player is firing, gun recoils towards camera (+Z). If opponent is firing, gun recoils backward (-Z)
      const directionMult = isPlayerFiring ? 1 : -1;
      activeGun.position.z = origZ + (ease * directionMult);

      if (recoilFrame < recoilFrames) {
        requestAnimationFrame(animateRecoil);
      } else {
        activeGun.position.z = origZ;
      }
    };
    requestAnimationFrame(animateRecoil);

    // — Muzzle flash —
    const flashColor = isLive ? 0xffaa00 : 0x888888;
    const flashIntensity = isLive ? 15 : 4;
    const flash = new THREE.PointLight(flashColor, flashIntensity, isLive ? 8 : 3);

    // Flash origin depends on who is firing
    const flashOffsetZ = isPlayerFiring ? -2.5 : 2.5;
    flash.position.set(
      activeGun.position.x,
      activeGun.position.y + 0.1,
      activeGun.position.z + flashOffsetZ
    );
    scene.add(flash);

    // Fade out flash
    let flashLife = 0;
    const flashDuration = isLive ? 8 : 4;
    const fadeFlash = () => {
      flashLife++;
      flash.intensity = flashIntensity * (1 - flashLife / flashDuration);
      if (flashLife < flashDuration) {
        requestAnimationFrame(fadeFlash);
      } else {
        scene.remove(flash);
      }
    };
    requestAnimationFrame(fadeFlash);

    // — Camera shake —
    const shakeIntensity = isLive ? 0.12 : 0.03;
    const shakeDuration = isLive ? 16 : 8;
    const origCamX = camera.position.x;
    const origCamY = camera.position.y;
    let shakeFrame = 0;

    const animateShake = () => {
      shakeFrame++;
      const decay = 1 - shakeFrame / shakeDuration;
      camera.position.x = origCamX + (Math.sin(shakeFrame * 3.7) * shakeIntensity * decay);
      camera.position.y = origCamY + (Math.cos(shakeFrame * 4.3) * shakeIntensity * decay);

      if (shakeFrame < shakeDuration) {
        requestAnimationFrame(animateShake);
      } else {
        camera.position.x = origCamX;
        camera.position.y = origCamY;
      }
    };
    requestAnimationFrame(animateShake);

    // — Screen background flash —
    if (isLive) {
      scene.background = new THREE.Color(0x331100);
      setTimeout(() => {
        scene.background = new THREE.Color(0x1a0500);
        setTimeout(() => {
          scene.background = new THREE.Color(0x050505);
        }, 80);
      }, 60);
    }
  }, []);

  const flashDealer = useCallback(() => {
    if (!sceneRef.current) return;
    const { dealerHead, ambientLight } = sceneRef.current;

    // Dealer head knockback + flash red
    const origY = dealerHead.position.y;
    const origZ = dealerHead.position.z;

    // If dealerHead is a Group, we need to tint its children
    dealerHead.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        child.material.color.setHex(0xff2222);
        child.material.emissive.setHex(0x660000);
      }
    });
    ambientLight.intensity = 2.5;

    // Knockback animation
    let knockFrame = 0;
    const knockFrames = 15;
    const animateKnock = () => {
      knockFrame++;
      const t = knockFrame / knockFrames;
      const knockback = Math.sin(t * Math.PI) * 0.3;
      dealerHead.position.z = origZ - knockback;
      dealerHead.position.y = origY + knockback * 0.2;

      if (knockFrame < knockFrames) {
        requestAnimationFrame(animateKnock);
      } else {
        dealerHead.position.y = origY;
        dealerHead.position.z = origZ;
        dealerHead.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
            // Restore original material colors based on what the child is
            // Skull is 0x0a0a0a, Jaw is 0x151515. We'll approximate a dark return state.
            child.material.color.setHex(0x111111);
            child.material.emissive.setHex(0x000000);
          }
        });
        ambientLight.intensity = 0.5;
      }
    };
    requestAnimationFrame(animateKnock);
  }, []);

  const flashScreen = useCallback(() => {
    if (!sceneRef.current) return;
    const { scene, ambientLight } = sceneRef.current;

    // Red flash when player gets shot
    scene.background = new THREE.Color(0x550000);
    ambientLight.intensity = 3;

    setTimeout(() => {
      scene.background = new THREE.Color(0x220000);
      ambientLight.intensity = 1.5;
      setTimeout(() => {
        scene.background = new THREE.Color(0x050505);
        ambientLight.intensity = 0.5;
      }, 100);
    }, 80);
  }, []);

  // Check game status from contract
  const checkGameStatus = useCallback(async (sid: number) => {
    const gameState = await buckshotRouletteService.getGame(sid);
    if (!gameState) return null;

    setGame(gameState);

    // Check ZK status
    const statusTag = getStatusTag(gameState.status);
    if (statusTag === 'AwaitingSeeds') {
      // Check commitments
      // Note: We'd need to query individual commitments
    }

    return gameState;
  }, [getStatusTag]);

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

      // Save to localStorage for persistence
      localStorage.setItem(`zk_seed_${sessionId}_${userAddress}`, JSON.stringify(Array.from(seed)));
      localStorage.setItem(`zk_commitment_${sessionId}_${userAddress}`, JSON.stringify(Array.from(commitment)));

      setMySeed(seed);
      setMyCommitment(commitment);

      log('ZK seed committed! (Your seed is hidden until reveal)');

      // Immediately check if both are committed now (we may be the second committer)
      const gameState = await buckshotRouletteService.getGame(sessionId);
      if (gameState) {
        setGame(gameState);
        const statusTag = getStatusTag(gameState.status);
        if (statusTag === 'AwaitingReveal') {
          log('Both players committed! Time to reveal...');
          setOpponentCommitted(true);
          setPhase('zk_reveal');
        } else {
          log('Waiting for opponent to commit...');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to commit seed');
    } finally {
      setIsLoading(false);
    }
  };

  // Poll for both players committed
  // This is now triggered automatically via useEffect when phase === 'zk_commit'
  useEffect(() => {
    if (phase !== 'zk_commit' || !sessionId || !game) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 60; // 2 min max

    const checkCommitments = async () => {
      try {
        const gameState = await buckshotRouletteService.getGame(sessionId);
        if (!gameState || cancelled) return;

        setGame(gameState);
        const statusTag = getStatusTag(gameState.status);

        if (statusTag === 'AwaitingReveal') {
          log('Both players committed! Time to reveal...');
          setOpponentCommitted(true);
          setPhase('zk_reveal');
          return; // stop polling
        }

        // Check individual opponent commitment via direct RPC
        if (statusTag === 'AwaitingSeeds' && gameState.player2) {
          // Determine if opponent is P1 or P2 in the game
          const opponentIsPlayer1 = gameState.player1 !== userAddress;
          try {
            const exists = await buckshotRouletteService.checkCommitmentExists(sessionId, opponentIsPlayer1);
            console.log('[checkCommitments] Opponent commitment exists:', exists, 'opponentIsP1:', opponentIsPlayer1);
            if (exists) {
              setOpponentCommitted(true);
              log('Opponent has committed their seed!');
            }
          } catch (e) {
            console.log('[checkCommitments] checkCommitmentExists error:', e);
          }
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    };

    // Immediate first check
    checkCommitments();

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts || cancelled) {
        if (attempts > maxAttempts) log('Polling timeout. Use Refresh button.');
        clearInterval(interval);
        return;
      }
      await checkCommitments();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase, sessionId, game?.player1, game?.player2, userAddress, getStatusTag, log]);

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
      console.log('[handleRevealSeed] Starting reveal, seed:', Array.from(mySeed.slice(0, 8)));

      try {
        await buckshotRouletteService.revealSeed(sessionId, userAddress, mySeed, signer);
        log('ZK seed revealed successfully!');
        console.log('[handleRevealSeed] Reveal transaction completed');
      } catch (revealErr) {
        const errMsg = revealErr instanceof Error ? revealErr.message : String(revealErr);
        console.error('[handleRevealSeed] Reveal failed:', revealErr);
        log('ERROR revealing seed: ' + errMsg);
        setError(errMsg);
        setIsLoading(false);
        return;
      }

      // Check if both seeds are revealed before trying expensive finalize
      const seedReady = await buckshotRouletteService.checkCombinedSeedExists(sessionId);
      if (seedReady) {
        try {
          log('Both seeds revealed! Finalizing...');
          await buckshotRouletteService.finalizeGameStart(sessionId, userAddress, signer);
          log('Game finalized! Starting...');

          const gameState = await buckshotRouletteService.getGame(sessionId);
          if (gameState && getStatusTag(gameState.status) === 'InProgress') {
            setGame(gameState);
            log(`Round 1: ${gameState.live_count} LIVE, ${gameState.blank_count} BLANK`);
            setPhase('round_start');
          }
        } catch (finalizeErr) {
          log('Finalize failed, starting poll...');
          pollForGameStart(sessionId);
        }
      } else {
        log('Waiting for opponent to reveal...');
        pollForGameStart(sessionId);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to reveal seed';
      console.error('[handleRevealSeed] Unexpected error:', err);
      setError(errMsg);
      log('ERROR: ' + errMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // Poll for game to start (both revealed)
  const pollForGameStart = async (sid: number) => {
    let attempts = 0;
    const maxAttempts = 60; // 2 min max

    const interval = setInterval(async () => {
      attempts++;

      if (attempts > maxAttempts) {
        log('Timeout waiting for opponent. Please try again.');
        clearInterval(interval);
        return;
      }

      try {
        // First check game state
        const gameState = await buckshotRouletteService.getGame(sid);

        if (gameState) {
          setGame(gameState);
          const statusTag = getStatusTag(gameState.status);

          if (statusTag === 'InProgress') {
            log('Game started! Shell sequence generated.');
            log(`Round 1: ${gameState.live_count} LIVE, ${gameState.blank_count} BLANK`);
            setPhase('round_start');
            clearInterval(interval);
            return;
          }
        }

        // Fast check: does CombinedSeed exist? (means both revealed)
        const seedReady = await buckshotRouletteService.checkCombinedSeedExists(sid);
        if (seedReady) {
          log('Both seeds revealed! Finalizing...');
          try {
            const signer = getContractSigner();
            await buckshotRouletteService.finalizeGameStart(sid, userAddress, signer);
            log('Game finalized!');

            const finalState = await buckshotRouletteService.getGame(sid);
            if (finalState) {
              setGame(finalState);
              if (getStatusTag(finalState.status) === 'InProgress') {
                log(`Round 1: ${finalState.live_count} LIVE, ${finalState.blank_count} BLANK`);
                setPhase('round_start');
                clearInterval(interval);
              }
            }
          } catch (e) {
            log('Finalize failed, retrying...');
          }
        } else {
          if (attempts % 5 === 0) {
            log(`Waiting for opponent to reveal... (${attempts}s)`);
          }
        }
      } catch (err) {
        console.error('Poll error:', err);
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

      triggerGunEffect(isLive, true); // Player fired

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

      triggerGunEffect(isLive, true); // Player fired

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

  // Poll for game state updates when playing — detect opponent's actions
  const prevHealthRef = useRef<{ player: number; opponent: number } | null>(null);

  useEffect(() => {
    if (phase !== 'playing' || !sessionId) return;

    // Initialize health tracking
    if (game && prevHealthRef.current === null) {
      const pH = (isPlayer1 ? game.p1_health : game.p2_health) ?? 0;
      const oH = (isPlayer1 ? game.p2_health : game.p1_health) ?? 0;
      prevHealthRef.current = { player: pH, opponent: oH };
    }

    const pollInterval = setInterval(async () => {
      try {
        const gameState = await buckshotRouletteService.getGame(sessionId);
        if (!gameState) return;

        const prevTurn = game?.turn;
        const newPlayerH = (gameState.player1 === userAddress ? gameState.p1_health : gameState.p2_health) ?? 0;
        const newOpponentH = (gameState.player1 === userAddress ? gameState.p2_health : gameState.p1_health) ?? 0;
        const prev = prevHealthRef.current;

        // Detect opponent shot US (our health dropped)
        if (prev && newPlayerH < prev.player) {
          log('💥 You got shot!');
          setLastShotResult({ isLive: true, target: 'self' });
          triggerGunEffect(true, false); // Opponent fired
          flashScreen();
        }

        // Detect opponent got hit (their health dropped — we shot them or they shot themselves)
        if (prev && newOpponentH < prev.opponent && newPlayerH === prev.player) {
          // Only trigger if WE didn't just shoot (our health didn't change)
          // This catches opponent shooting themselves with a live round
          if (prevTurn === game?.turn) {
            // Turn didn't change from our action — opponent did something
            log('💥 Opponent took damage!');
            triggerGunEffect(true, false); // Opponent fired
            flashDealer();
          }
        }

        // Detect turn change
        if (prevTurn !== undefined && prevTurn !== gameState.turn) {
          const nowMyTurn = (gameState.turn === 1 && gameState.player1 === userAddress) ||
            (gameState.turn === 2 && gameState.player2 === userAddress);
          if (nowMyTurn) {
            log("⚡ It's your turn now!");
          } else {
            log("⏳ Opponent's turn...");
          }
        }

        // Update health tracking
        prevHealthRef.current = { player: newPlayerH, opponent: newOpponentH };
        setGame(gameState);

        // Check winner
        if (gameState.winner) {
          setGameOverMsg(gameState.winner === userAddress ? 'YOU WIN' : 'YOU DIED');
          setPhase('game_over');
          onGameComplete();
          return;
        }

        // Check new round needed
        if (gameState.shells_remaining === 0 && !gameState.winner && getStatusTag(gameState.status) === 'InProgress') {
          prevHealthRef.current = null; // Reset tracking for new round
          setPhase('round_start');
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 1500);

    return () => clearInterval(pollInterval);
  }, [phase, sessionId, userAddress, onGameComplete, game?.turn, isPlayer1, log, triggerGunEffect, flashDealer, flashScreen, getStatusTag]);

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
      <div className="vhs-noise" />
      <div className="vignette" />

      {/* ── Main Menu ──────────────────────────────── */}
      {phase === 'menu' && (
        <div className="menu-overlay">
          <h1>Buckshot Roulette</h1>
          <p className="subtitle">ZK Commit-Reveal Edition</p>
          <div className="menu-divider" />
          <p className="zk-info">Shell sequence generated from combined player seeds — provably fair on Stellar</p>
          <div className="menu-buttons">
            <button onClick={() => setPhase('create')} className="btn-enter">
              Create Game
            </button>
            <button onClick={() => setPhase('join')} className="btn-enter secondary">
              Join Game
            </button>
          </div>
          <button onClick={onBack} className="btn-back-menu">
            ← Back to Games
          </button>
        </div>
      )}

      {/* ── Create Game ────────────────────────────── */}
      {phase === 'create' && (
        <div className="menu-overlay">
          <h2>Create Game</h2>
          <div className="setup-form">
            <label>
              <span>Your Address</span>
              <input type="text" value={userAddress} disabled />
            </label>
            <label>
              <span>Points to Wager</span>
              <input type="text" value="100" disabled />
            </label>
            <button onClick={handleCreateGame} disabled={isLoading} className="btn-start">
              {isLoading && <span className="loading-spinner" />}
              {isLoading ? 'Creating Game...' : 'Create Game'}
            </button>
            <button onClick={() => setPhase('menu')} className="btn-back-menu">
              ← Back
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {/* ── Join Game ──────────────────────────────── */}
      {phase === 'join' && (
        <div className="menu-overlay">
          <h2>Join Game</h2>
          <div className="setup-form">
            <label>
              <span>Your Address</span>
              <input type="text" value={userAddress} disabled />
            </label>
            <label>
              <span>Session ID</span>
              <input
                type="text"
                value={joinSessionId}
                onChange={(e) => setJoinSessionId(e.target.value)}
                placeholder="Enter session ID"
              />
            </label>
            <button onClick={handleJoinGame} disabled={isLoading} className="btn-start">
              {isLoading && <span className="loading-spinner" />}
              {isLoading ? 'Joining...' : 'Join Game'}
            </button>
            <button onClick={() => setPhase('menu')} className="btn-back-menu">
              ← Back
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {/* ── Waiting for Opponent ────────────────────── */}
      {phase === 'waiting' && sessionId && (
        <div className="menu-overlay">
          <h2>Waiting for Opponent</h2>
          <div className="session-info">
            <p>Share this Session ID with your opponent:</p>
            <div className="session-id-display">{sessionId}</div>
            <button
              onClick={() => navigator.clipboard.writeText(sessionId.toString())}
              className="btn-copy"
            >
              📋 Copy Session ID
            </button>
          </div>
          <p className="waiting-text">
            <span className="loading-spinner" />
            Waiting for opponent to join<span className="waiting-dots" />
          </p>
          <button onClick={() => setPhase('menu')} className="btn-back-menu">
            Cancel
          </button>
        </div>
      )}

      {/* ── ZK Commit Phase ────────────────────────── */}
      {phase === 'zk_commit' && game && (
        <div className="menu-overlay">
          {/* Step Progress */}
          <div className="step-indicator">
            <div className="step-dot active">1</div>
            <div className="step-line" />
            <div className="step-dot">2</div>
            <div className="step-line" />
            <div className="step-dot">3</div>
          </div>
          <span className="phase-tag commit">Commit Phase</span>

          <h2>Commit Seed</h2>
          <div className="zk-info-box">
            <p>Both players must commit a secret seed.</p>
            <p>The seeds will be combined to generate the shell sequence.</p>
            <p>Nobody can predict the shells until both reveal!</p>
          </div>

          <div className="zk-status">
            <div className={`zk-player ${myCommitment ? 'committed' : ''}`}>
              <span>YOU</span>
              <span>{myCommitment ? '✅ Committed' : '⏳ Pending'}</span>
            </div>
            <div className="zk-vs">VS</div>
            <div className={`zk-player opponent ${opponentCommitted || getStatusTag(game.status) === 'AwaitingReveal' ? 'committed' : ''}`}>
              <span>OPPONENT</span>
              <span>{opponentCommitted || getStatusTag(game.status) === 'AwaitingReveal' ? '✅ Committed' : '⏳ Pending'}</span>
            </div>
          </div>

          <button
            onClick={handleCommitSeed}
            disabled={isLoading || !!myCommitment}
            className="btn-zk"
          >
            {isLoading && <span className="loading-spinner amber" />}
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
                try {
                  const gs = await buckshotRouletteService.getGame(sessionId);
                  if (gs) {
                    setGame(gs);
                    const statusTag = getStatusTag(gs.status);
                    log(`Status: ${statusTag}`);
                    if (statusTag === 'AwaitingReveal') {
                      log('Both players committed! Moving to reveal...');
                      setOpponentCommitted(true);
                      setPhase('zk_reveal');
                    } else if (statusTag === 'AwaitingSeeds') {
                      const opponentIsPlayer1 = gs.player1 !== userAddress;
                      try {
                        const exists = await buckshotRouletteService.checkCommitmentExists(sessionId, opponentIsPlayer1);
                        if (exists) {
                          setOpponentCommitted(true);
                          log('Opponent has committed their seed!');
                        } else {
                          log('Opponent has not committed yet.');
                        }
                      } catch (e) {
                        log('Could not check opponent. Waiting...');
                      }
                    }
                  }
                } catch (e) {
                  log('Error: ' + (e instanceof Error ? e.message : 'Unknown'));
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

      {/* ── ZK Reveal Phase ────────────────────────── */}
      {phase === 'zk_reveal' && game && (
        <div className="menu-overlay">
          {/* Step Progress */}
          <div className="step-indicator">
            <div className="step-dot done">✓</div>
            <div className="step-line done" />
            <div className="step-dot active">2</div>
            <div className="step-line" />
            <div className="step-dot">3</div>
          </div>
          <span className="phase-tag reveal">Reveal Phase</span>

          <h2>Reveal Seed</h2>
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

              <div className="reveal-buttons">
                <button
                  onClick={handleRevealSeed}
                  disabled={isLoading}
                  className="btn-zk reveal"
                >
                  {isLoading && <span className="loading-spinner green" />}
                  {isLoading ? 'Revealing...' : 'Reveal My Seed'}
                </button>

                <button
                  onClick={async () => {
                    if (!sessionId) return;
                    setIsLoading(true);
                    try {
                      const signer = getContractSigner();
                      log('Trying to finalize game...');
                      await buckshotRouletteService.finalizeGameStart(sessionId, userAddress, signer);
                      log('Game finalized!');
                      const gs = await buckshotRouletteService.getGame(sessionId);
                      if (gs && getStatusTag(gs.status) === 'InProgress') {
                        setGame(gs);
                        log(`Round 1: ${gs.live_count} LIVE, ${gs.blank_count} BLANK`);
                        setPhase('round_start');
                      }
                    } catch (e) {
                      log('Not ready yet — opponent must reveal first');
                    }
                    setIsLoading(false);
                  }}
                  disabled={isLoading}
                  className="btn-zk finalize"
                >
                  {isLoading && <span className="loading-spinner green" />}
                  🚀 Finalize Game
                </button>
              </div>
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

      {/* ── Round Start ────────────────────────────── */}
      {phase === 'round_start' && game && (
        <div className="round-notification">
          {/* Step Progress */}
          <div className="step-indicator" style={{ justifyContent: 'center', marginBottom: '16px' }}>
            <div className="step-dot done">✓</div>
            <div className="step-line done" />
            <div className="step-dot done">✓</div>
            <div className="step-line done" />
            <div className="step-dot active">3</div>
          </div>

          <h2>ROUND {game.round}</h2>
          <span className="zk-badge">🔐 ZK Verified</span>

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

      {/* ── Game UI (Playing) ──────────────────────── */}
      {phase === 'playing' && game && (
        <div className="game-ui">
          <img src={crosshairSvg} alt="" className="crosshair" />

          <div className="stats-bar">
            <div className="health-container">
              <div className="health-label">OPPONENT</div>
              <div className="health-icons">{renderHealth(opponentHealth)}</div>
            </div>

            <div className="turn-indicator">
              {isPlayerTurn ? '⚡ YOUR TURN' : '⏳ OPPONENT'}
            </div>

            <div className="health-container">
              <div className="health-label">YOU</div>
              <div className="health-icons">{renderHealth(playerHealth)}</div>
            </div>
          </div>

          {lastShotResult && (
            <div className={`shot-result ${lastShotResult.isLive ? 'live' : 'blank'}`}>
              {lastShotResult.isLive ? '💥 LIVE!' : '💨 BLANK!'}
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
                {isLoading && <span className="loading-spinner" />}
                🎯 SHOOT OPPONENT
              </button>
              <button
                onClick={handleShootSelf}
                disabled={!isPlayerTurn || isLoading}
              >
                {isLoading && <span className="loading-spinner" />}
                🔫 SHOOT SELF
              </button>
            </div>
            <div className="game-info">
              Round {game.round} · {game.shells_remaining} shells · 🔐 ZK
            </div>
          </div>

          {error && <div className="error-toast">{error}</div>}
        </div>
      )}

      {/* ── Game Over ──────────────────────────────── */}
      {phase === 'game_over' && (
        <div className="menu-overlay game-over">
          <h1 style={{ color: gameOverMsg === 'YOU WIN' ? 'var(--br-green)' : 'var(--br-red)' }}>
            {gameOverMsg}
          </h1>
          <span className="zk-badge">🔐 Verified on-chain with ZK commit-reveal</span>
          <button onClick={() => {
            setPhase('menu');
            setGame(null);
            setSessionId(null);
            setLogs([]);
            setMySeed(null);
            setMyCommitment(null);
            setOpponentCommitted(false);
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
};
