const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 8080;

// Serve static files from dist/
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ===== GAME CONSTANTS =====
const MAP_W = 3000;
const MAP_H = 3000;
const WALL_THICKNESS = 40;
const MAX_PLAYERS = 5;
const SEGMENT_GAP = 18;
const HEAD_RADIUS = 16;
const BODY_RADIUS = 12;
const INITIAL_SEGMENTS = 5;
const FOOD_PER_PLAYER = 15;
const MIN_FOOD = 20;
const TICK_RATE = 1000 / 20; // 20 ticks per second
const ROUND_RESTART_DELAY = 5000;
const NUT_TYPES = 3;

// Interior wall obstacles (must match client)
const OBSTACLES = [
  { x: 600, y: 600, w: 200, h: 40 },
  { x: 1200, y: 400, w: 40, h: 250 },
  { x: 1800, y: 800, w: 300, h: 40 },
  { x: 500, y: 1500, w: 40, h: 300 },
  { x: 2200, y: 1200, w: 250, h: 40 },
  { x: 1000, y: 2000, w: 40, h: 200 },
  { x: 1600, y: 1600, w: 200, h: 40 },
  { x: 2400, y: 2000, w: 40, h: 250 },
  { x: 800, y: 2400, w: 300, h: 40 },
  { x: 2000, y: 2500, w: 200, h: 40 },
  { x: 1400, y: 1000, w: 40, h: 200 },
  { x: 400, y: 1000, w: 150, h: 40 },
];

// ===== GAME STATE =====
const players = {};
let foods = [];
let roundActive = false;
let foodIdCounter = 0;
let playerNameCounter = 0;
const NAMES = ['Свинья', 'Волчок', 'Кабан', 'Хрюша', 'Бурый', 'Клык', 'Пятак', 'Серый', 'Рыло', 'Лютый'];

// ===== HELPERS =====
function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function getSpawnPoint() {
  const margin = WALL_THICKNESS + 100;
  for (let attempt = 0; attempt < 50; attempt++) {
    const x = rand(margin, MAP_W - margin);
    const y = rand(margin, MAP_H - margin);
    if (!isInWall(x, y)) return { x, y };
  }
  return { x: MAP_W / 2, y: MAP_H / 2 };
}

function isInWall(x, y) {
  // Border walls
  if (x < WALL_THICKNESS + HEAD_RADIUS || x > MAP_W - WALL_THICKNESS - HEAD_RADIUS ||
      y < WALL_THICKNESS + HEAD_RADIUS || y > MAP_H - WALL_THICKNESS - HEAD_RADIUS) {
    return true;
  }
  // Interior obstacles
  for (const o of OBSTACLES) {
    if (x > o.x - HEAD_RADIUS && x < o.x + o.w + HEAD_RADIUS &&
        y > o.y - HEAD_RADIUS && y < o.y + o.h + HEAD_RADIUS) {
      return true;
    }
  }
  return false;
}

function isInWallBody(x, y) {
  if (x < WALL_THICKNESS + BODY_RADIUS || x > MAP_W - WALL_THICKNESS - BODY_RADIUS ||
      y < WALL_THICKNESS + BODY_RADIUS || y > MAP_H - WALL_THICKNESS - BODY_RADIUS) {
    return true;
  }
  for (const o of OBSTACLES) {
    if (x > o.x - BODY_RADIUS && x < o.x + o.w + BODY_RADIUS &&
        y > o.y - BODY_RADIUS && y < o.y + o.h + BODY_RADIUS) {
      return true;
    }
  }
  return false;
}

function generateFood() {
  const playerCount = Object.keys(players).length;
  const targetFood = Math.max(MIN_FOOD, playerCount * FOOD_PER_PLAYER);

  while (foods.length < targetFood) {
    const margin = WALL_THICKNESS + 20;
    let x, y;
    for (let i = 0; i < 20; i++) {
      x = rand(margin, MAP_W - margin);
      y = rand(margin, MAP_H - margin);
      if (!isInWallBody(x, y)) break;
    }
    foods.push({
      id: 'f' + (foodIdCounter++),
      x, y,
      type: Math.floor(Math.random() * NUT_TYPES)
    });
  }
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function checkCollisions() {
  const ids = Object.keys(players);

  for (const id of ids) {
    const p = players[id];
    if (!p || !p.alive) continue;

    // Wall collision
    if (isInWall(p.x, p.y)) {
      killPlayer(id);
      continue;
    }

    // Food collision
    for (let i = foods.length - 1; i >= 0; i--) {
      if (dist(p, foods[i]) < HEAD_RADIUS + 10) {
        p.score += 1;
        p.growQueue += 1;
        foods.splice(i, 1);
      }
    }

    // Collision with other snakes' bodies
    for (const otherId of ids) {
      if (otherId === id) continue;
      const other = players[otherId];
      if (!other || !other.alive) continue;

      // Head vs other head
      if (dist(p, other) < HEAD_RADIUS * 2) {
        killPlayer(id);
        killPlayer(otherId);
        break;
      }

      // Head vs other body segments
      for (const seg of other.segments) {
        if (dist(p, seg) < HEAD_RADIUS + BODY_RADIUS) {
          killPlayer(id);
          break;
        }
      }
      if (!p.alive) break;
    }

    // Self collision (skip first few segments)
    if (p.alive && p.segments.length > 8) {
      for (let i = 8; i < p.segments.length; i++) {
        if (dist(p, p.segments[i]) < HEAD_RADIUS + BODY_RADIUS * 0.5) {
          killPlayer(id);
          break;
        }
      }
    }
  }
}

function killPlayer(id) {
  const p = players[id];
  if (!p || !p.alive) return;
  p.alive = false;
  io.emit('player_died', { id, name: p.name });

  // Check if round should end
  const alivePlayers = Object.values(players).filter(p => p.alive);
  if (alivePlayers.length <= 1 && Object.keys(players).length > 1) {
    const winner = alivePlayers[0] || null;
    io.emit('round_over', {
      winnerId: winner ? winner.id : null,
      winnerName: winner ? winner.name : 'Никто'
    });
    roundActive = false;

    // Restart round after delay
    setTimeout(() => {
      startNewRound();
    }, ROUND_RESTART_DELAY);
  }
}

function startNewRound() {
  foods = [];
  foodIdCounter = 0;

  // Reset all connected players
  for (const id in players) {
    const spawn = getSpawnPoint();
    const p = players[id];
    p.x = spawn.x;
    p.y = spawn.y;
    p.segments = [];
    p.path = [];
    p.alive = true;
    p.score = 0;
    p.growQueue = INITIAL_SEGMENTS;
    p.angle = 0;
    p.speed = 0;

    // Initialize path
    for (let i = 0; i < INITIAL_SEGMENTS * 2; i++) {
      p.path.push({ x: spawn.x, y: spawn.y });
    }
  }

  generateFood();
  roundActive = true;
  io.emit('new_round');
}

// ===== GAME LOOP =====
function gameTick() {
  if (!roundActive) return;

  for (const id in players) {
    const p = players[id];
    if (!p.alive) continue;

    // Apply movement
    if (p.angle !== null && p.speed > 0) {
      const rad = p.angle * (Math.PI / 180);
      p.x += Math.cos(rad) * p.speed * (TICK_RATE / 1000);
      p.y += Math.sin(rad) * p.speed * (TICK_RATE / 1000);
    }

    // Update path history
    p.path.unshift({ x: p.x, y: p.y });

    // Grow or maintain tail
    const targetLength = (INITIAL_SEGMENTS + p.score) * SEGMENT_GAP;
    if (p.growQueue > 0) {
      p.growQueue--;
      // Allow path to grow
      if (p.path.length > targetLength + SEGMENT_GAP * 2) {
        p.path.pop();
      }
    } else {
      while (p.path.length > targetLength) {
        p.path.pop();
      }
    }

    // Build segment positions from path
    p.segments = [];
    const numSegs = INITIAL_SEGMENTS + p.score;
    for (let i = 1; i <= numSegs; i++) {
      const idx = i * SEGMENT_GAP;
      if (idx < p.path.length) {
        p.segments.push({ x: p.path[idx].x, y: p.path[idx].y });
      }
    }
  }

  checkCollisions();
  generateFood();

  // Build state to send
  const state = { players: {}, foods };
  for (const id in players) {
    const p = players[id];
    state.players[id] = {
      x: p.x,
      y: p.y,
      segments: p.segments,
      score: p.score,
      alive: p.alive,
      name: p.name
    };
  }

  io.emit('state', state);
}

setInterval(gameTick, TICK_RATE);

// ===== SOCKET HANDLING =====
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  if (Object.keys(players).length >= MAX_PLAYERS) {
    socket.emit('server_full');
    socket.disconnect();
    return;
  }

  socket.on('join', () => {
    const spawn = getSpawnPoint();
    const name = NAMES[playerNameCounter % NAMES.length];
    playerNameCounter++;

    players[socket.id] = {
      id: socket.id,
      x: spawn.x,
      y: spawn.y,
      segments: [],
      path: [],
      alive: true,
      score: 0,
      growQueue: INITIAL_SEGMENTS,
      angle: null,
      speed: 0,
      name
    };

    // Initialize path
    for (let i = 0; i < INITIAL_SEGMENTS * SEGMENT_GAP * 2; i++) {
      players[socket.id].path.push({ x: spawn.x, y: spawn.y });
    }

    // Start round if enough players or first player
    if (!roundActive) {
      roundActive = true;
      generateFood();
    }

    console.log(`Player ${name} joined (${Object.keys(players).length}/${MAX_PLAYERS})`);
  });

  socket.on('input', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    p.angle = data.angle;
    p.speed = data.speed || 0;
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    delete players[socket.id];

    // Check round state
    const alivePlayers = Object.values(players).filter(p => p.alive);
    if (alivePlayers.length <= 1 && Object.keys(players).length > 1 && roundActive) {
      const winner = alivePlayers[0] || null;
      io.emit('round_over', {
        winnerId: winner ? winner.id : null,
        winnerName: winner ? winner.name : 'Никто'
      });
      roundActive = false;
      setTimeout(() => startNewRound(), ROUND_RESTART_DELAY);
    }

    if (Object.keys(players).length === 0) {
      roundActive = false;
      foods = [];
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Свино-болт сервер запущен на порту ${PORT}`);
});
