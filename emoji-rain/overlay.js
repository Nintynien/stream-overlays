import { BaseOverlay } from '../core/base-overlay.js';
import { extractAllEmojis } from './emoji-parser.js';

/**
 * Emoji rain overlay - emojis fall from top to bottom when sent in chat
 * Supports both Unicode emojis and platform-specific emotes (like Kick custom emotes)
 */
export class EmojiRainOverlay extends BaseOverlay {
  constructor(config) {
    super(config);
    this.sevenTvEmotes = new Map(); // name -> url
    this.settings = {
      fallDuration: config.settings?.fallDuration || 5000,
      fontSize: config.settings?.fontSize || 48,
      ...config.settings
    };
  }

  onInit() {
    this._load7tvGlobalEmotes();

    // Load channel-specific 7TV emotes for each connected platform
    for (const client of this.clients) {
      if (client.roomId) {
        // Twitch client already has roomId
        this._load7tvChannelEmotes('twitch', client.roomId);
      } else if (client.on && this.config.twitch?.enabled) {
        // Wait for Twitch ROOMSTATE
        client.on('roomid', (roomId) => {
          this._load7tvChannelEmotes('twitch', roomId);
        });
      }
      if (client.userId && this.config.kick?.enabled) {
        this._load7tvChannelEmotes('kick', client.userId);
      }
    }

    console.log('Emoji Rain overlay initialized');
  }

  onMessage(message) {
    // Match 7TV emotes in message text
    if (this.sevenTvEmotes.size > 0) {
      const sevenTvMatches = [];
      const words = message.message.split(' ');
      for (const word of words) {
        if (this.sevenTvEmotes.has(word)) {
          sevenTvMatches.push({ id: word, name: word, url: this.sevenTvEmotes.get(word) });
        }
      }
      if (sevenTvMatches.length > 0) {
        message = { ...message, emotes: [...(message.emotes || []), ...sevenTvMatches] };
      }
    }

    const emojis = extractAllEmojis(message);
    if (emojis.length > 0) {
      emojis.forEach(emoji => {
        this.spawnFallingEmoji(emoji);
      });
    }
  }

  async _load7tvGlobalEmotes() {
    try {
      const res = await fetch('https://7tv.io/v3/emote-sets/global');
      const data = await res.json();
      if (data.emotes) {
        for (const emote of data.emotes) {
          this.sevenTvEmotes.set(emote.name, `https://cdn.7tv.app/emote/${emote.id}/4x.webp`);
        }
        console.log(`[7TV] Loaded ${data.emotes.length} global emotes`);
      }
    } catch (err) {
      console.warn('[7TV] Failed to load global emotes:', err);
    }
  }

  async _load7tvChannelEmotes(platform, userId) {
    try {
      const res = await fetch(`https://7tv.io/v3/users/${platform}/${userId}`);
      const data = await res.json();
      if (data.emote_set?.emotes) {
        for (const emote of data.emote_set.emotes) {
          this.sevenTvEmotes.set(emote.name, `https://cdn.7tv.app/emote/${emote.id}/4x.webp`);
        }
        console.log(`[7TV] Loaded ${data.emote_set.emotes.length} channel emotes for ${platform}`);
      }
    } catch (err) {
      console.warn(`[7TV] Failed to load channel emotes for ${platform}:`, err);
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
