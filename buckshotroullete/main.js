import * as THREE from 'three';

// --- Game State & Logic ---
const STATE = {
  PRE_ROUND: 'PRE_ROUND',
  PLAYER_TURN: 'PLAYER_TURN',
  DEALER_TURN: 'DEALER_TURN',
  RESOLVING: 'RESOLVING',
  GAME_OVER: 'GAME_OVER'
};

const GAME_CONFIG = {
  maxHealth: 4, 
  shellsPerRound: 0 
};

class GameState {
  constructor() {
    this.resetState();
  }

  resetState() {
    this.playerHealth = GAME_CONFIG.maxHealth;
    this.dealerHealth = GAME_CONFIG.maxHealth;
    this.chamber = [];
    this.currentShell = null;
    this.state = STATE.PRE_ROUND;
    this.roundCount = 0;
  }
  
  resetGame() {
      this.resetState();
      logEl.innerHTML = ''; // Clear log
      this.startRound();
  }

  startRound() {
    this.roundCount++;
    const liveCount = Math.floor(Math.random() * 3) + 1;
    const blankCount = Math.floor(Math.random() * 3) + 1;
    const total = liveCount + blankCount;
    
    this.chamber = [];
    for(let i=0; i<liveCount; i++) this.chamber.push('live');
    for(let i=0; i<blankCount; i++) this.chamber.push('blank');
    
    // Shuffle
    for (let i = this.chamber.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.chamber[i], this.chamber[j]] = [this.chamber[j], this.chamber[i]];
    }

    log(`Round ${this.roundCount} started.`);
    
    // Show Notification
    showRoundStart(liveCount, blankCount);
  }
  
  beginTurn() {
    this.state = STATE.PLAYER_TURN;
    updateUI();
  }

  nextShell() {
    return this.chamber.pop();
  }
}

const game = new GameState();

// --- Three.js Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);
scene.fog = new THREE.Fog(0x050505, 5, 20);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 3, 6);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 0.5); 
scene.add(ambientLight);

const spotLight = new THREE.SpotLight(0xffffff, 20);
spotLight.position.set(0, 10, 0);
spotLight.angle = Math.PI / 6;
spotLight.penumbra = 0.5;
spotLight.castShadow = true;
scene.add(spotLight);

// Environment
const tableGeometry = new THREE.BoxGeometry(8, 0.2, 5);
const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.8 });
const table = new THREE.Mesh(tableGeometry, tableMaterial);
table.receiveShadow = true;
scene.add(table);

// Dealer (Simple Representation)
const dealerGroup = new THREE.Group();
const dealerBody = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 2, 1),
  new THREE.MeshStandardMaterial({ color: 0x111111 }) // Dark figure
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

// Shotgun (Simple Representation)
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
scene.add(shotgunGroup);


// --- Animation Loop ---
function animate() {
  requestAnimationFrame(animate);
  
  // Idle animations
  dealerHead.position.y = 2.4 + Math.sin(Date.now() * 0.001) * 0.05;
  
  renderer.render(scene, camera);
}
animate();

// --- Logic & Interactions ---

const btnShootDealer = document.getElementById('btn-shoot-dealer');
const btnShootSelf = document.getElementById('btn-shoot-self');
const dealerHealthEl = document.getElementById('dealer-health');
const playerHealthEl = document.getElementById('player-health');
const turnIndicatorEl = document.getElementById('turn-indicator');
const logEl = document.getElementById('log');

const uiLayer = document.getElementById('ui-layer');
const mainMenu = document.getElementById('main-menu');
const startBtn = document.getElementById('start-btn');
const notificationEl = document.getElementById('center-notification');
const notifTitle = document.getElementById('notification-title');
const notifMsg = document.getElementById('notification-msg');
const shellCountDisplay = document.getElementById('shell-count-display');
const ackBtn = document.getElementById('ack-btn');

const gameOverMenu = document.getElementById('game-over-menu');
const gameOverTitle = document.getElementById('game-over-title');
const restartBtn = document.getElementById('restart-btn');

startBtn.addEventListener('click', () => {
    mainMenu.classList.add('hidden');
    uiLayer.classList.remove('hidden');
    game.resetGame();
});

restartBtn.addEventListener('click', () => {
    gameOverMenu.classList.add('hidden');
    uiLayer.classList.remove('hidden');
    game.resetGame();
});

ackBtn.addEventListener('click', () => {
    notificationEl.style.display = 'none';
    game.beginTurn();
});

function showRoundStart(live, blank) {
    notifTitle.textContent = "ITEMS LOADED";
    notifMsg.textContent = `${live} LIVE, ${blank} BLANK`;
    
    shellCountDisplay.innerHTML = '';
    // Visualize shells
    for(let i=0; i<live; i++) {
        const d = document.createElement('div');
        d.className = 'shell-group';
        d.innerHTML = `<img src="/assets/images/shell-live.svg" class="shell-img"><span style="color:#d00">LIVE</span>`;
        shellCountDisplay.appendChild(d);
    }
    for(let i=0; i<blank; i++) {
        const d = document.createElement('div');
        d.className = 'shell-group';
        d.innerHTML = `<img src="/assets/images/shell-blank.svg" class="shell-img"><span style="color:#888">BLANK</span>`;
        shellCountDisplay.appendChild(d);
    }

    notificationEl.style.display = 'flex';
}


function log(msg) {
    const p = document.createElement('div');
    p.textContent = `> ${msg}`;
    logEl.appendChild(p);
    logEl.scrollTop = logEl.scrollHeight;
}

function updateHealthDisplay(element, currentHP, maxHP) {
    element.innerHTML = '';
    for(let i=0; i<maxHP; i++) {
        const icon = document.createElement('div');
        icon.className = 'health-icon' + (i >= currentHP ? ' lost' : '');
        element.appendChild(icon);
    }
}

function updateUI() {
    updateHealthDisplay(dealerHealthEl, game.dealerHealth, GAME_CONFIG.maxHealth);
    updateHealthDisplay(playerHealthEl, game.playerHealth, GAME_CONFIG.maxHealth);
    
    if (game.state === STATE.GAME_OVER) {
        turnIndicatorEl.textContent = "GAME OVER";
        btnShootDealer.disabled = true;
        btnShootSelf.disabled = true;
        return;
    }

    turnIndicatorEl.textContent = game.state === STATE.PLAYER_TURN ? "YOUR TURN" : "DEALER'S TURN";
    
    const isPlayerTurn = game.state === STATE.PLAYER_TURN;
    btnShootDealer.disabled = !isPlayerTurn;
    btnShootSelf.disabled = !isPlayerTurn;
}

// Gun Animation Utils
function animateGun(target, isLive, callback) {
    const startRot = shotgunGroup.rotation.clone();
    
    let targetRot = new THREE.Euler(0, 0, 0);
    
    if (target === 'dealer') {
        // Point at dealer
        targetRot = new THREE.Euler(-0.2, 0, 0); 
    } else if (target === 'self') {
        // Point at self (camera)
        targetRot = new THREE.Euler(0, Math.PI, 0);
    }

    // Simple tween
    let progress = 0;
    const duration = 20; // frames
    
    function step() {
        progress++;
        const t = progress / duration;
        
        // Linear interp for now
        shotgunGroup.rotation.x = THREE.MathUtils.lerp(startRot.x, targetRot.x, t);
        shotgunGroup.rotation.y = THREE.MathUtils.lerp(startRot.y, targetRot.y, t);
        
        if (progress < duration) {
            requestAnimationFrame(step);
        } else {
            // Fire!
            triggerGunEffect(isLive);
            setTimeout(() => {
                resetGun(callback);
            }, 500);
        }
    }
    step();
}

function resetGun(callback) {
    const duration = 20;
    let progress = 0;
    const startRot = shotgunGroup.rotation.clone();
    
    function step() {
        progress++;
        const t = progress / duration;
        shotgunGroup.rotation.x = THREE.MathUtils.lerp(startRot.x, 0, t);
        shotgunGroup.rotation.y = THREE.MathUtils.lerp(startRot.y, Math.PI / 2, t); // Resting pos (sideways)
        
        if (progress < duration) {
            requestAnimationFrame(step);
        } else {
             shotgunGroup.rotation.set(0, Math.PI/2, 0); // Reset to table
             if (callback) callback();
        }
    }
    // step(); 
    // Actually, let's just snap back for prototype speed or do a simple reset
     shotgunGroup.rotation.set(0, Math.PI/2, 0); // Reset immediately for now to save complexity
     if (callback) callback();
}

// Initial Gun Pos
shotgunGroup.rotation.y = Math.PI / 2;


function triggerGunEffect(isLive) {
    if (isLive) {
        // Big Flash for Live Round
        const flash = new THREE.PointLight(0xffaa00, 10, 5);
        flash.position.copy(shotgunGroup.position);
        scene.add(flash);
        setTimeout(() => scene.remove(flash), 100);
        
        // Big Camera shake
        const originalCamY = camera.position.y;
        camera.position.y += 0.1;
        setTimeout(() => camera.position.y = originalCamY, 50);
    } else {
        // Small "Click" or Spark for Blank
        const flash = new THREE.PointLight(0x555555, 2, 2); // Dim grey light
        flash.position.copy(shotgunGroup.position);
        scene.add(flash);
        setTimeout(() => scene.remove(flash), 50);
        
        // Tiny shake (click feel)
        const originalCamY = camera.position.y;
        camera.position.y += 0.02;
        setTimeout(() => camera.position.y = originalCamY, 30);
    }
}


async function resolveShot(target) {
    game.state = STATE.RESOLVING;
    updateUI();

    const shell = game.nextShell();
    const isLive = shell === 'live';
    
    log(`Shot fired at ${target}... it was ${isLive ? 'LIVE' : 'BLANK'}!`);

    await new Promise(r => animateGun(target, isLive, r));

    if (isLive) {
        if (target === 'dealer') {
            game.dealerHealth--;
            // Hit reaction
            dealerHead.material.color.setHex(0xff0000);
            setTimeout(() => dealerHead.material.color.setHex(0x880000), 200);
        } else {
            game.playerHealth--;
            // Red screen flash
            scene.background = new THREE.Color(0x550000);
            setTimeout(() => scene.background = new THREE.Color(0x050505), 100);
        }
    }

    checkGameOver();
    
    if (game.state !== STATE.GAME_OVER) {
        if (game.chamber.length === 0) {
            setTimeout(() => game.startRound(), 2000);
        } else {
            // Turn Logic
            if (target === 'self' && !isLive) {
                // Shoot self with blank = extra turn
                if (game.state !== STATE.GAME_OVER) { // check again
                     game.state = STATE.PLAYER_TURN; // Keep turn
                     log("Blank on self. Player keeps turn.");
                }
            } else {
                // Switch turn
                game.state = STATE.DEALER_TURN;
                setTimeout(dealerAI, 1000);
            }
        }
    }
    updateUI();
}

function dealerAI() {
    if (game.state === STATE.GAME_OVER) return;
    
    log("Dealer is thinking...");
    
    setTimeout(() => {
        // Simple AI
        const shootPlayer = Math.random() > 0.4; // 60% chance to shoot player
        handleDealerShot(shootPlayer);
    }, 1500);
}

async function handleDealerShot(shootsPlayer) {
    const shell = game.nextShell();
    const isLive = shell === 'live';
    
    log(`Dealer shoots ${shootsPlayer ? 'YOU' : 'HIMSELF'}...`);
    
    // Quick animation override
    shotgunGroup.rotation.y = shootsPlayer ? 0 : Math.PI; 
    // Wait
    await new Promise(r => setTimeout(r, 500));
    triggerGunEffect(isLive);
    
    log(`...it was ${isLive ? 'LIVE' : 'BLANK'}!`);

    if (isLive) {
        if (shootsPlayer) {
             game.playerHealth--;
             scene.background = new THREE.Color(0x550000);
             setTimeout(() => scene.background = new THREE.Color(0x050505), 100);
        } else {
             game.dealerHealth--;
             dealerHead.material.color.setHex(0xff0000);
             setTimeout(() => dealerHead.material.color.setHex(0x880000), 200);
        }
    }
    
    // Reset gun
    shotgunGroup.rotation.set(0, Math.PI/2, 0);

    checkGameOver();
    
    if (game.state !== STATE.GAME_OVER) {
         if (game.chamber.length === 0) {
            setTimeout(() => game.startRound(), 2000);
        } else {
            // Turn Logic
            if (!shootsPlayer && !isLive) {
                // Dealer shot self with blank -> keeps turn
                log("Dealer blanked himself. Dealer keeps turn.");
                setTimeout(dealerAI, 1000);
            } else {
                game.state = STATE.PLAYER_TURN;
                log("Player's turn.");
            }
        }
    }
    updateUI();
}

function checkGameOver() {
    if (game.playerHealth <= 0) {
        game.state = STATE.GAME_OVER;
        showGameOver("YOU DIED");
    } else if (game.dealerHealth <= 0) {
        game.state = STATE.GAME_OVER;
        showGameOver("YOU WIN");
    }
}

function showGameOver(msg) {
    setTimeout(() => {
        uiLayer.classList.add('hidden');
        gameOverMenu.classList.remove('hidden');
        gameOverTitle.textContent = msg;
        if (msg === "YOU WIN") {
            gameOverTitle.style.color = "#33ff33";
        } else {
            gameOverTitle.style.color = "#ff3333";
        }
    }, 1000);
}

// Input Handlers
btnShootDealer.addEventListener('click', () => {
    if (game.state !== STATE.PLAYER_TURN) return;
    resolveShot('dealer');
});

btnShootSelf.addEventListener('click', () => {
    if (game.state !== STATE.PLAYER_TURN) return;
    resolveShot('self');
});


// Initial Update
updateUI();

// Handle resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
