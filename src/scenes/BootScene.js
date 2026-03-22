import Phaser from 'phaser';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Boot' });
  }

  preload() {
    // Load nut collectibles
    this.load.image('hazelnut', 'assets/images/nuts/hazelnut.png');
    this.load.image('chestnut', 'assets/images/nuts/chestnut.png');
    this.load.image('walnut', 'assets/images/nuts/walnut.png');
    this.load.image('tilemap', 'assets/images/tilemap_16x16.png');

    // Loading bar
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const bar = this.add.graphics();
    const box = this.add.graphics();
    box.fillStyle(0x222222, 0.8);
    box.fillRect(w / 4, h / 2 - 15, w / 2, 30);

    const title = this.add.text(w / 2, h / 2 - 50, 'СВИНО-БОЛТ', {
      fontSize: '32px',
      fontFamily: 'Arial, sans-serif',
      color: '#ff4444',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    this.load.on('progress', (value) => {
      bar.clear();
      bar.fillStyle(0xcc3333, 1);
      bar.fillRect(w / 4 + 5, h / 2 - 10, (w / 2 - 10) * value, 20);
    });

    this.load.on('complete', () => {
      bar.destroy();
      box.destroy();
      title.destroy();
    });
  }

  create() {
    this.scene.start('Game');
  }
}
