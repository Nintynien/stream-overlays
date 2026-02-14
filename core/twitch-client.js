import { ChatClient } from './chat-client.js';

/**
 * Twitch chat client using IRC WebSocket
 */
export class TwitchClient extends ChatClient {
  constructor(config) {
    super(config);
    this.ws = null;
    this.channel = config.channel;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

      this.ws.onopen = () => {
        // Anonymous login (read-only)
        this.ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        this.ws.send('NICK justinfan12345');
        this.ws.send(`JOIN #${this.channel}`);
        this.connected = true;
        this.emit('connected', { platform: 'twitch' });
        resolve();
      };

      this.ws.onmessage = (event) => {
        this._handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('Twitch WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.emit('disconnected', { platform: 'twitch' });
      };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  _handleMessage(rawMessage) {
    const lines = rawMessage.split('\r\n').filter(line => line.length > 0);

    lines.forEach(line => {
      // Handle PING
      if (line.startsWith('PING')) {
        this.ws.send('PONG :tmi.twitch.tv');
        return;
      }

      // Parse PRIVMSG (chat messages)
      if (line.includes('PRIVMSG')) {
        const message = this._parsePrivMsg(line);
        if (message) {
          const standardMessage = this._createMessage(
            'twitch',
            message.username,
            message.message,
            message.color
          );
          this.emit('message', standardMessage);
        }
      }
    });
  }

  _parsePrivMsg(line) {
    // Format: @tags :user!user@user.tmi.twitch.tv PRIVMSG #channel :message
    const messageMatch = line.match(/PRIVMSG #\w+ :(.+)$/);
    const userMatch = line.match(/:(\w+)!\w+@\w+\.tmi\.twitch\.tv/);

    // Extract color from tags
    let color = null;
    const colorMatch = line.match(/color=(#[0-9A-Fa-f]{6})/);
    if (colorMatch) {
      color = colorMatch[1];
    }

    if (messageMatch && userMatch) {
      return {
        username: userMatch[1],
        message: messageMatch[1],
        color: color
      };
    }
    return null;
  }
}
