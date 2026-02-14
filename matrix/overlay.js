import { BaseOverlay } from '../core/base-overlay.js';

/**
 * Matrix-style falling code overlay
 * Displays falling characters with chat messages mixed in
 */
export class MatrixOverlay extends BaseOverlay {
  constructor(config) {
    super(config);
    this.settings = {
      ...config.settings,
      fontSize: config.settings?.fontSize || 32,
      speed: config.settings?.speed || 50, // ms per frame
      columnWidth: config.settings?.columnWidth || 48,
      // Multiply column speed when displaying a message (0.5 = half speed)
      messageSpeedMultiplier: config.settings?.messageSpeedMultiplier ?? 0.25,
    };

    this.columns = [];
    this.messageQueue = [];
    this.animationFrame = null;

    // Matrix-style character set (mix of Latin, numbers, and symbols)
    this.chars = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  }

  onInit() {
    console.log('Matrix overlay initialized');
    this.setupColumns();
    this.startAnimation();
  }

  onMessage(message) {
    // Add username to queue
    this.messageQueue.push(message.username);
  }

  setupColumns() {
    const columnCount = Math.floor(window.innerWidth / this.settings.columnWidth);
    const columnHeight = Math.floor(window.innerHeight / this.settings.fontSize);

    for (let i = 0; i < columnCount; i++) {
      this.columns.push({
        x: i * this.settings.columnWidth,
        y: Math.random() * -columnHeight, // Start at random heights
        speed: 0.5 + Math.random() * 1, // Random speed multiplier
        chars: [],
        length: 10 + Math.floor(Math.random() * 20), // Random trail length
        usingMessage: false,
        messageChars: [],
        messageIndex: 0
      });
    }
  }

  startAnimation() {
    const animate = () => {
      this.update();
      this.draw();
      setTimeout(() => {
        this.animationFrame = requestAnimationFrame(animate);
      }, this.settings.speed);
    };
    animate();
  }

  update() {
    this.columns.forEach(column => {
      // Move column down
      const messageSpeedMultiplier = column.usingMessage
        ? this.settings.messageSpeedMultiplier
        : 1;
      column.y += column.speed * messageSpeedMultiplier;

      // Reset column when it goes off screen
      const maxY = window.innerHeight / this.settings.fontSize;
      if (column.y > maxY + column.length) {
        column.y = -column.length;
        column.usingMessage = false;
        column.messageChars = [];
        column.messageIndex = 0;

        // 30% chance to use a queued message if available
        if (this.messageQueue.length > 0 && Math.random() < 0.3) {
          const message = this.messageQueue.shift();
          column.messageChars = message.split('');
          column.usingMessage = true;
          column.length = Math.max(column.messageChars.length, 15);
        } else {
          column.length = 10 + Math.floor(Math.random() * 20);
        }
      }

      // Update characters in the column
      column.chars = [];

      // Reveal message characters one by one as column falls
      if (column.usingMessage && column.y >= 0) {
        const revealedCount = Math.min(
          Math.floor(column.y),
          column.messageChars.length
        );
        if (revealedCount > column.messageIndex) {
          column.messageIndex = revealedCount;
        }
      }

      for (let i = 0; i < column.length; i++) {
        const charY = Math.floor(column.y) - i;

        if (charY >= 0 && charY < maxY) {
          let char;
          let isMessage = false;

          if (column.usingMessage && i < column.messageIndex) {
            // Use message character (stable, no flickering)
            char = column.messageChars[i];
            isMessage = true;
          } else {
            // Use random character with flickering
            if (Math.random() < 0.05) {
              char = this.chars[Math.floor(Math.random() * this.chars.length)];
            } else {
              char = column.chars[i]?.char || this.chars[Math.floor(Math.random() * this.chars.length)];
            }
          }

          column.chars.push({
            char: char,
            y: charY,
            opacity: 1 - (i / column.length), // Fade from head to tail
            isMessage: isMessage
          });
        }
      }
    });
  }

  draw() {
    // Clear previous render
    this.container.innerHTML = '';

    this.columns.forEach(column => {
      column.chars.forEach((charData, index) => {
        const charElement = document.createElement('div');
        charElement.className = 'matrix-char';
        charElement.textContent = charData.char;
        charElement.style.left = `${column.x}px`;
        charElement.style.top = `${charData.y * this.settings.fontSize}px`;
        charElement.style.fontSize = `${this.settings.fontSize}px`;

        // Message characters get special styling
        if (charData.isMessage) {
          charElement.classList.add('message');
          charElement.style.opacity = 1; // Always full brightness
        } else if (index === 0) {
          // Head character is brighter (for non-message columns)
          charElement.classList.add('head');
        } else {
          charElement.style.opacity = charData.opacity;
        }

        this.container.appendChild(charElement);
      });
    });
  }

  disconnect() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    super.disconnect();
  }
}
