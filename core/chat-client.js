import { EventEmitter } from './event-emitter.js';

/**
 * Base chat client class
 * Emits standardized events: 'message', 'connected', 'disconnected'
 */
export class ChatClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.connected = false;
  }

  connect() {
    throw new Error('connect() must be implemented by subclass');
  }

  disconnect() {
    throw new Error('disconnect() must be implemented by subclass');
  }

  /**
   * Standardized message format
   * @returns {Object} { platform, username, message, color, timestamp }
   */
  _createMessage(platform, username, message, color = null) {
    return {
      platform,
      username,
      message,
      color,
      timestamp: Date.now()
    };
  }
}
