import { BaseOverlay } from '../core/base-overlay.js';
import { extractAllEmojis } from './emoji-parser.js';

/**
 * Emoji rain overlay - emojis fall from top to bottom when sent in chat
 * Supports both Unicode emojis and platform-specific emotes (like Kick custom emotes)
 */
export class EmojiRainOverlay extends BaseOverlay {
  constructor(config) {
    super(config);
    this.settings = {
      fallDuration: config.settings?.fallDuration || 5000,
      fontSize: config.settings?.fontSize || 48,
      ...config.settings
    };
  }

  onInit() {
    console.log('Emoji Rain overlay initialized');
  }

  onMessage(message) {
    const emojis = extractAllEmojis(message.message, message.platform);
    if (emojis.length > 0) {
      emojis.forEach(emoji => {
        this.spawnFallingEmoji(emoji);
      });
    }
  }

  spawnFallingEmoji(emoji) {
    const emojiElement = document.createElement('div');
    emojiElement.className = 'falling-emoji';

    // Handle both text emojis and image emotes
    if (emoji.type === 'emote' && emoji.url) {
      // Kick custom emote - use image
      const img = document.createElement('img');
      img.src = emoji.url;
      img.alt = emoji.content;
      img.style.width = `${this.settings.fontSize}px`;
      img.style.height = `${this.settings.fontSize}px`;
      img.style.objectFit = 'contain';
      emojiElement.appendChild(img);
    } else {
      // Unicode emoji - use text
      emojiElement.textContent = emoji.content;
      emojiElement.style.fontSize = `${this.settings.fontSize}px`;
    }

    // Random horizontal position
    const randomX = Math.random() * window.innerWidth;
    emojiElement.style.left = `${randomX}px`;

    // Optional: slight rotation
    const randomRotation = Math.random() * 360;
    emojiElement.style.transform = `rotate(${randomRotation}deg)`;

    // Optional: slight horizontal drift
    const drift = (Math.random() - 0.5) * 100;
    emojiElement.style.setProperty('--drift', `${drift}px`);

    this.createAnimatedElement(
      emojiElement,
      'fall',
      this.settings.fallDuration
    );
  }
}
