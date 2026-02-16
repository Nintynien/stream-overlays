import { TwitchClient } from './twitch-client.js';
import { KickClient } from './kick-client.js';

/**
 * Base overlay class that handles chat connections
 * Extend this class to create custom overlays
 */
export class BaseOverlay {
  constructor(config) {
    this.config = config;
    this.clients = [];
    this.container = null;
  }

  /**
   * Initialize the overlay
   */
  async init() {
    this.container = document.getElementById('overlay-container') || document.body;
    await this.connectChats();
    this.onInit();
  }

  /**
   * Connect to configured chat platforms
   */
  async connectChats() {
    const promises = [];

    if (this.config.twitch?.enabled && this.config.twitch?.channel) {
      const twitchClient = new TwitchClient({
        channel: this.config.twitch.channel,
        debug: this.config.debug
      });

      twitchClient.on('message', (msg) => this.onMessage(msg));
      twitchClient.on('connected', () => console.log('Connected to Twitch'));
      twitchClient.on('disconnected', () => console.log('Disconnected from Twitch'));

      this.clients.push(twitchClient);
      promises.push(twitchClient.connect());
    }

    if (this.config.kick?.enabled && (this.config.kick?.channelId || this.config.kick?.channel)) {
      const kickClient = new KickClient({
        channelId: this.config.kick.channelId,
        channelName: this.config.kick.channel,
        debug: this.config.debug
      });

      kickClient.on('message', (msg) => this.onMessage(msg));
      kickClient.on('connected', () => console.log('Connected to Kick'));
      kickClient.on('disconnected', () => console.log('Disconnected from Kick'));

      this.clients.push(kickClient);
      promises.push(kickClient.connect());
    }

    await Promise.all(promises);
  }

  /**
   * Disconnect all chat clients
   */
  disconnect() {
    this.clients.forEach(client => client.disconnect());
    this.clients = [];
  }

  /**
   * Override this method in your overlay
   */
  onInit() {
    console.log('Overlay initialized');
  }

  /**
   * Override this method to handle chat messages
   * @param {Object} message - { platform, username, message, emojis, timestamp }
   */
  onMessage(message) {
    console.log('Message received:', message);
  }

  /**
   * Helper to create and animate elements
   */
  createAnimatedElement(element, animationName, duration = 3000, onComplete = null) {
    this.container.appendChild(element);

    element.style.animation = `${animationName} ${duration}ms linear`;

    setTimeout(() => {
      element.remove();
      if (onComplete) onComplete();
    }, duration);

    return element;
  }
}
