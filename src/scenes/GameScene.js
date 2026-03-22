import Phaser from 'phaser';
import { io } from 'socket.io-client';

const MAP_W = 3000;
const MAP_H = 3000;
const WALL_THICKNESS = 40;
const SEGMENT_GAP = 18;
const HEAD_RADIUS = 16;
const BODY_RADIUS = 12;
const NUT_TYPES = ['hazelnut', 'chestnut', 'walnut'];
const BASE_SPEED = 160;
const SPEED_INCREMENT = 2; // per second of game time
const MAX_SPEED = 400;

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Game' });
    this.socket = null;
    this.players = {};    // id -> { head, segments, path, score, alive, nameText }
    this.myId = null;
    this.foods = {};      // id -> sprite
    this.joystick = null;
    this.joystickPointer = null;
    this.moveAngle = null;
    this.gameSpeed = BASE_SPEED;
    this.gameStartTime = 0;
    this.spectating = false;
    this.walls = [];
    this.scoreTexts = {};
    this.roundOverText = null;
  }

  create() {
    // Dark forest background
    this.cameras.main.setBackgroundColor('#0d0d0d');
    this.cameras.main.setBounds(0, 0, MAP_W, MAP_H);

    // Draw background pattern (dark forest floor)
    this._drawBackground();

    // Draw walls
    this._drawWalls();

    // Create wall physics bodies
    this.wallGroup = this.physics.add.staticGroup();
    // Top
    this._addWallRect(0, 0, MAP_W, WALL_THICKNESS);
    // Bottom
    this._addWallRect(0, MAP_H - WALL_THICKNESS, MAP_W, WALL_THICKNESS);
    // Left
    this._addWallRect(0, 0, WALL_THICKNESS, MAP_H);
    // Right
    this._addWallRect(MAP_W - WALL_THICKNESS, 0, WALL_THICKNESS, MAP_H);

    // Add some interior stone obstacles
    this._addInteriorWalls();

    // Food group
    this.foodGroup = this.add.group();

    // UI layer (fixed to camera)
    this.uiCamera = this.cameras.main;
    this.scoreText = this.add.text(10, 10, 'Очки: 0', {
      fontSize: '20px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffcc00',
      stroke: '#000',
      strokeThickness: 3
    }).setScrollFactor(0).setDepth(100);

    this.playerListText = this.add.text(this.cameras.main.width - 10, 10, '', {
      fontSize: '16px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffffff',
      stroke: '#000',
      strokeThickness: 2,
      align: 'right'
    }).setScrollFactor(0).setOrigin(1, 0).setDepth(100);

    this.titleText = this.add.text(this.cameras.main.width / 2, 10, 'СВИНО-БОЛТ', {
      fontSize: '18px',
      fontFamily: 'Arial, sans-serif',
      color: '#cc3333',
      stroke: '#000',
      strokeThickness: 3,
      fontStyle: 'bold'
    }).setScrollFactor(0).setOrigin(0.5, 0).setDepth(100);

    // Joystick setup (bottom-right)
    this._setupJoystick();

    // Connect to server
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    const port = window.location.port || (protocol === 'https:' ? 443 : 80);
    this.socket = io(`${protocol}//${host}:${port}`);

    this.socket.on('connect', () => {
      this.myId = this.socket.id;
      this.socket.emit('join');
    });

    this.socket.on('state', (state) => this._onState(state));
    this.socket.on('food_update', (foods) => this._onFoodUpdate(foods));
    this.socket.on('player_died', (data) => this._onPlayerDied(data));
    this.socket.on('round_over', (data) => this._onRoundOver(data));
    this.socket.on('new_round', () => this._onNewRound());
    this.socket.on('disconnect', () => this._onDisconnect());

    this.gameStartTime = this.time.now;

    // Handle resize
    this.scale.on('resize', (gameSize) => {
      this.cameras.main.setSize(gameSize.width, gameSize.height);
      this.playerListText.setX(gameSize.width - 10);
      this.titleText.setX(gameSize.width / 2);
      this._repositionJoystick();
    });
  }

  update(time, delta) {
    if (!this.myId || this.spectating) return;

    // Gradually increase speed
    const elapsed = (time - this.gameStartTime) / 1000;
    this.gameSpeed = Math.min(BASE_SPEED + elapsed * SPEED_INCREMENT, MAX_SPEED);

    // Send input to server
    if (this.moveAngle !== null) {
      this.socket.emit('input', { angle: this.moveAngle, speed: this.gameSpeed });
    } else {
      this.socket.emit('input', { angle: null, speed: this.gameSpeed });
    }
  }

  // ===== BACKGROUND =====

  _drawBackground() {
    const bg = this.add.graphics();
    bg.fillStyle(0x0d0d0d, 1);
    bg.fillRect(0, 0, MAP_W, MAP_H);

    // Dark forest floor texture - scattered dark dots
    const rng = new Phaser.Math.RandomDataGenerator(['forest']);
    for (let i = 0; i < 2000; i++) {
      const x = rng.between(WALL_THICKNESS, MAP_W - WALL_THICKNESS);
      const y = rng.between(WALL_THICKNESS, MAP_H - WALL_THICKNESS);
      const shade = rng.between(0x08, 0x14);
      const color = (shade << 16) | (shade << 8) | shade;
      bg.fillStyle(color, 0.5);
      bg.fillCircle(x, y, rng.between(1, 3));
    }

    // Some dark red/brown patches (blood forest vibe)
    for (let i = 0; i < 200; i++) {
      const x = rng.between(WALL_THICKNESS, MAP_W - WALL_THICKNESS);
      const y = rng.between(WALL_THICKNESS, MAP_H - WALL_THICKNESS);
      bg.fillStyle(0x1a0505, 0.3);
      bg.fillCircle(x, y, rng.between(5, 20));
    }

    bg.setDepth(-10);
  }

  // ===== WALLS =====

  _drawWalls() {
    const wallGfx = this.add.graphics();
    wallGfx.fillStyle(0x333333, 1);
    wallGfx.lineStyle(2, 0x555555, 1);

    // Border walls
    wallGfx.fillRect(0, 0, MAP_W, WALL_THICKNESS);
    wallGfx.fillRect(0, MAP_H - WALL_THICKNESS, MAP_W, WALL_THICKNESS);
    wallGfx.fillRect(0, 0, WALL_THICKNESS, MAP_H);
    wallGfx.fillRect(MAP_W - WALL_THICKNESS, 0, WALL_THICKNESS, MAP_H);

    // Stone texture on walls
    const rng = new Phaser.Math.RandomDataGenerator(['walls']);
    for (let i = 0; i < 500; i++) {
      const side = rng.between(0, 3);
      let x, y;
      if (side === 0) { x = rng.between(0, MAP_W); y = rng.between(0, WALL_THICKNESS); }
      else if (side === 1) { x = rng.between(0, MAP_W); y = rng.between(MAP_H - WALL_THICKNESS, MAP_H); }
      else if (side === 2) { x = rng.between(0, WALL_THICKNESS); y = rng.between(0, MAP_H); }
      else { x = rng.between(MAP_W - WALL_THICKNESS, MAP_W); y = rng.between(0, MAP_H); }
      wallGfx.fillStyle(rng.between(0, 1) ? 0x444444 : 0x2a2a2a, 0.7);
      wallGfx.fillRect(x, y, rng.between(3, 8), rng.between(3, 8));
    }
    wallGfx.setDepth(-5);
  }

  _addWallRect(x, y, w, h) {
    const zone = this.add.zone(x + w / 2, y + h / 2, w, h);
    this.physics.add.existing(zone, true);
    this.wallGroup.add(zone);
  }

  _addInteriorWalls() {
    const wallGfx = this.add.graphics();
    wallGfx.setDepth(-4);

    // Predefined interior stone obstacles
    const obstacles = [
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

    obstacles.forEach(o => {
      wallGfx.fillStyle(0x3d2b2b, 1);
      wallGfx.fillRect(o.x, o.y, o.w, o.h);
      // Stone texture
      wallGfx.fillStyle(0x4a3535, 0.6);
      for (let i = 0; i < 5; i++) {
        wallGfx.fillRect(
          o.x + Math.random() * o.w,
          o.y + Math.random() * o.h,
          3 + Math.random() * 5,
          3 + Math.random() * 5
        );
      }
      this._addWallRect(o.x, o.y, o.w, o.h);
    });
  }

  // ===== JOYSTICK =====

  _setupJoystick() {
    const cam = this.cameras.main;
    this.joystickBase = this.add.graphics().setScrollFactor(0).setDepth(200);
    this.joystickThumb = this.add.graphics().setScrollFactor(0).setDepth(201);
    this.joystickRadius = 60;
    this.joystickX = 0;
    this.joystickY = 0;
    this._repositionJoystick();
    this._drawJoystick(this.joystickX, this.joystickY);

    this.input.on('pointerdown', (pointer) => {
      // Only activate if in the right half of screen
      if (pointer.x > cam.width * 0.4 && !this.joystickPointer) {
        this.joystickPointer = pointer;
        this.joystickX = pointer.x;
        this.joystickY = pointer.y;
        this._drawJoystick(this.joystickX, this.joystickY);
      }
    });

    this.input.on('pointermove', (pointer) => {
      if (this.joystickPointer && pointer.id === this.joystickPointer.id) {
        const dx = pointer.x - this.joystickX;
        const dy = pointer.y - this.joystickY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 10) {
          this.moveAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          const clampDist = Math.min(dist, this.joystickRadius);
          const thumbX = this.joystickX + (dx / dist) * clampDist;
          const thumbY = this.joystickY + (dy / dist) * clampDist;
          this._drawJoystickThumb(thumbX, thumbY);
        } else {
          this.moveAngle = null;
          this._drawJoystickThumb(this.joystickX, this.joystickY);
        }
      }
    });

    this.input.on('pointerup', (pointer) => {
      if (this.joystickPointer && pointer.id === this.joystickPointer.id) {
        this.joystickPointer = null;
        this.moveAngle = null;
        this._repositionJoystick();
        this._drawJoystick(this.joystickX, this.joystickY);
      }
    });

    // Keyboard fallback (WASD / arrows)
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    });

    // Override update for keyboard
    const origUpdate = this.update.bind(this);
    this.update = (time, delta) => {
      // Keyboard input
      if (!this.joystickPointer) {
        let kx = 0, ky = 0;
        if (this.cursors.left.isDown || this.wasd.left.isDown) kx -= 1;
        if (this.cursors.right.isDown || this.wasd.right.isDown) kx += 1;
        if (this.cursors.up.isDown || this.wasd.up.isDown) ky -= 1;
        if (this.cursors.down.isDown || this.wasd.down.isDown) ky += 1;
        if (kx !== 0 || ky !== 0) {
          this.moveAngle = Math.atan2(ky, kx) * (180 / Math.PI);
        } else if (!this.joystickPointer) {
          this.moveAngle = null;
        }
      }
      origUpdate(time, delta);
    };
  }

  _repositionJoystick() {
    const cam = this.cameras.main;
    this.joystickX = cam.width - 100;
    this.joystickY = cam.height - 100;
  }

  _drawJoystick(x, y) {
    this.joystickBase.clear();
    this.joystickBase.fillStyle(0x333333, 0.4);
    this.joystickBase.fillCircle(x, y, this.joystickRadius);
    this.joystickBase.lineStyle(2, 0x666666, 0.5);
    this.joystickBase.strokeCircle(x, y, this.joystickRadius);
    this._drawJoystickThumb(x, y);
  }

  _drawJoystickThumb(x, y) {
    this.joystickThumb.clear();
    this.joystickThumb.fillStyle(0xcc3333, 0.6);
    this.joystickThumb.fillCircle(x, y, 22);
  }

  // ===== NETWORK EVENTS =====

  _onState(state) {
    // state = { players: { id: { x, y, segments: [{x,y}], score, alive, name } }, foods: [...] }
    const serverPlayers = state.players;

    // Update/create players
    for (const id in serverPlayers) {
      const sp = serverPlayers[id];
      if (!this.players[id]) {
        this._createPlayer(id, sp);
      }
      this._updatePlayer(id, sp);
    }

    // Remove disconnected players
    for (const id in this.players) {
      if (!serverPlayers[id]) {
        this._removePlayer(id);
      }
    }

    // Camera follow
    if (this.myId && this.players[this.myId] && this.players[this.myId].alive) {
      const me = this.players[this.myId];
      this.cameras.main.scrollX = me.head.x - this.cameras.main.width / 2;
      this.cameras.main.scrollY = me.head.y - this.cameras.main.height / 2;
    } else if (this.spectating) {
      // Follow first alive player
      for (const id in this.players) {
        if (this.players[id].alive) {
          this.cameras.main.scrollX = this.players[id].head.x - this.cameras.main.width / 2;
          this.cameras.main.scrollY = this.players[id].head.y - this.cameras.main.height / 2;
          break;
        }
      }
    }

    // Update UI
    this._updateUI(serverPlayers);

    // Update foods
    if (state.foods) {
      this._onFoodUpdate(state.foods);
    }
  }

  _createPlayer(id, data) {
    const isMe = id === this.myId;
    const headColor = isMe ? 0xcc3333 : 0x8844aa;
    const bodyColor = isMe ? 0xffaaaa : 0xddaaee;

    const head = this.add.graphics();
    head.x = data.x;
    head.y = data.y;
    this._drawHead(head, headColor);
    head.setDepth(10);

    // Eyes
    const eyeContainer = this.add.container(data.x, data.y).setDepth(11);

    const nameText = this.add.text(data.x, data.y - HEAD_RADIUS - 12, data.name || 'Игрок', {
      fontSize: '12px',
      fontFamily: 'Arial',
      color: isMe ? '#ff6666' : '#cc88ee',
      stroke: '#000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(12);

    this.players[id] = {
      head,
      eyeContainer,
      segments: [],
      headColor,
      bodyColor,
      alive: data.alive !== false,
      score: data.score || 0,
      nameText,
      lastAngle: 0
    };
  }

  _drawHead(gfx, color) {
    gfx.clear();
    // Werewolf-ish head (snout shape)
    gfx.fillStyle(color, 1);
    gfx.fillCircle(0, 0, HEAD_RADIUS);
    // Ears
    gfx.fillTriangle(-10, -12, -6, -22, -2, -12);
    gfx.fillTriangle(10, -12, 6, -22, 2, -12);
    // Snout
    gfx.fillStyle(color + 0x111111, 1);
    gfx.fillEllipse(0, 6, 12, 8);
    // Pig nose
    gfx.fillStyle(0xff9999, 1);
    gfx.fillCircle(-3, 6, 3);
    gfx.fillCircle(3, 6, 3);
    // Eyes
    gfx.fillStyle(0xffff00, 1);
    gfx.fillCircle(-6, -3, 3);
    gfx.fillCircle(6, -3, 3);
    gfx.fillStyle(0x000000, 1);
    gfx.fillCircle(-6, -3, 1.5);
    gfx.fillCircle(6, -3, 1.5);
  }

  _updatePlayer(id, data) {
    const p = this.players[id];
    if (!p) return;

    p.alive = data.alive !== false;
    p.score = data.score || 0;

    if (!p.alive) {
      p.head.setAlpha(0.3);
      p.nameText.setAlpha(0.3);
      p.segments.forEach(s => s.setAlpha(0.3));
      if (id === this.myId && !this.spectating) {
        this.spectating = true;
        this._showSpectateMessage();
      }
      return;
    }

    // Smooth movement via lerp
    const lerpFactor = 0.3;
    p.head.x = Phaser.Math.Linear(p.head.x, data.x, lerpFactor);
    p.head.y = Phaser.Math.Linear(p.head.y, data.y, lerpFactor);
    p.nameText.x = p.head.x;
    p.nameText.y = p.head.y - HEAD_RADIUS - 12;
    p.eyeContainer.x = p.head.x;
    p.eyeContainer.y = p.head.y;

    // Rotate head towards movement direction
    if (data.segments && data.segments.length > 0) {
      const dx = data.x - data.segments[0].x;
      const dy = data.y - data.segments[0].y;
      if (dx !== 0 || dy !== 0) {
        p.lastAngle = Math.atan2(dy, dx);
      }
    }
    p.head.rotation = p.lastAngle - Math.PI / 2;

    // Update tail segments (pink fleshy sausages)
    const segs = data.segments || [];
    // Add/remove segment graphics as needed
    while (p.segments.length < segs.length) {
      const seg = this.add.graphics();
      seg.setDepth(5);
      p.segments.push(seg);
    }
    while (p.segments.length > segs.length) {
      p.segments.pop().destroy();
    }

    // Draw segments
    for (let i = 0; i < segs.length; i++) {
      const seg = p.segments[i];
      const targetX = segs[i].x;
      const targetY = segs[i].y;
      seg.x = Phaser.Math.Linear(seg.x, targetX, lerpFactor);
      seg.y = Phaser.Math.Linear(seg.y, targetY, lerpFactor);

      seg.clear();
      // Sausage body: pinkish, getting slightly smaller toward tail
      const scale = 1.0 - (i / segs.length) * 0.3;
      const r = BODY_RADIUS * scale;
      seg.fillStyle(p.bodyColor, 0.9);
      seg.fillCircle(0, 0, r);
      // Fleshy rings
      seg.lineStyle(1, 0xff8888, 0.3);
      seg.strokeCircle(0, 0, r * 0.6);
    }
  }

  _removePlayer(id) {
    const p = this.players[id];
    if (!p) return;
    p.head.destroy();
    p.eyeContainer.destroy();
    p.nameText.destroy();
    p.segments.forEach(s => s.destroy());
    delete this.players[id];
  }

  // ===== FOOD =====

  _onFoodUpdate(foods) {
    // Remove old foods not in new list
    const newIds = new Set(foods.map(f => f.id));
    for (const fid in this.foods) {
      if (!newIds.has(fid)) {
        this.foods[fid].destroy();
        delete this.foods[fid];
      }
    }

    // Add/update foods
    for (const f of foods) {
      if (!this.foods[f.id]) {
        const type = NUT_TYPES[f.type % NUT_TYPES.length];
        let sprite;
        if (this.textures.exists(type)) {
          sprite = this.add.image(f.x, f.y, type);
          sprite.setScale(0.4);
        } else {
          // Fallback: draw a circle
          sprite = this.add.graphics();
          sprite.fillStyle(0xaa6633, 1);
          sprite.fillCircle(0, 0, 8);
          sprite.x = f.x;
          sprite.y = f.y;
        }
        sprite.setDepth(3);
        this.foods[f.id] = sprite;
      }
    }
  }

  // ===== DEATH / ROUND =====

  _onPlayerDied(data) {
    if (data.id === this.myId) {
      this.spectating = true;
      this._showSpectateMessage();
    }
  }

  _showSpectateMessage() {
    if (this.spectateText) return;
    this.spectateText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2 + 50,
      'ВЫ ПОГИБЛИ! Наблюдение...',
      {
        fontSize: '28px',
        fontFamily: 'Arial',
        color: '#ff4444',
        stroke: '#000',
        strokeThickness: 4
      }
    ).setScrollFactor(0).setOrigin(0.5).setDepth(300);

    this.time.delayedCall(3000, () => {
      if (this.spectateText) {
        this.spectateText.setAlpha(0.5);
        this.spectateText.setText('Наблюдение...');
        this.spectateText.setFontSize(18);
      }
    });
  }

  _onRoundOver(data) {
    const winnerName = data.winnerName || 'Никто';
    if (this.roundOverText) this.roundOverText.destroy();
    this.roundOverText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2 - 30,
      `РАУНД ОКОНЧЕН!\nПобедитель: ${winnerName}`,
      {
        fontSize: '36px',
        fontFamily: 'Arial',
        color: '#ffcc00',
        stroke: '#000',
        strokeThickness: 5,
        align: 'center'
      }
    ).setScrollFactor(0).setOrigin(0.5).setDepth(300);
  }

  _onNewRound() {
    // Clear round-over messages
    if (this.roundOverText) { this.roundOverText.destroy(); this.roundOverText = null; }
    if (this.spectateText) { this.spectateText.destroy(); this.spectateText = null; }
    this.spectating = false;

    // Clear old player graphics
    for (const id in this.players) {
      this._removePlayer(id);
    }
    this.players = {};

    // Clear foods
    for (const fid in this.foods) {
      this.foods[fid].destroy();
    }
    this.foods = {};

    this.gameStartTime = this.time.now;

    // Re-join
    this.socket.emit('join');
  }

  _onDisconnect() {
    if (this.roundOverText) this.roundOverText.destroy();
    const dcText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      'ОТКЛЮЧЕНО ОТ СЕРВЕРА',
      {
        fontSize: '30px',
        fontFamily: 'Arial',
        color: '#ff0000',
        stroke: '#000',
        strokeThickness: 4
      }
    ).setScrollFactor(0).setOrigin(0.5).setDepth(300);
  }

  // ===== UI =====

  _updateUI(serverPlayers) {
    // My score
    if (this.myId && serverPlayers[this.myId]) {
      this.scoreText.setText(`Очки: ${serverPlayers[this.myId].score}`);
    }

    // Player list (top-right)
    const entries = Object.entries(serverPlayers)
      .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
    let listStr = 'Игроки:\n';
    entries.forEach(([id, p], i) => {
      const marker = id === this.myId ? '► ' : '  ';
      const dead = p.alive === false ? ' 💀' : '';
      listStr += `${marker}${p.name || 'Игрок'}: ${p.score || 0}${dead}\n`;
    });
    this.playerListText.setText(listStr);
  }
}
