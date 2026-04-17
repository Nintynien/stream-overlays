import { ChatClient } from './chat-client.js';

/**
 * Twitch chat client using IRC WebSocket
 */
export class TwitchClient extends ChatClient {
  constructor(config) {
    super(config);
    this.ws = null;
    this.channel = config.channel;
    this.roomId = null;
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
      this._log('[Twitch]', line);

      // Handle PING
      if (line.startsWith('PING')) {
        this.ws.send('PONG :tmi.twitch.tv');
        return;
      }

      // Parse ROOMSTATE to get channel/room ID
      if (line.includes('ROOMSTATE') && !this.roomId) {
        const roomIdMatch = line.match(/room-id=(\d+)/);
        if (roomIdMatch) {
          this.roomId = roomIdMatch[1];
          this.emit('roomid', this.roomId);
        }
      }

      // Parse PRIVMSG (chat messages)
      if (line.includes('PRIVMSG')) {
        const message = this._parsePrivMsg(line);
        if (message) {
          const standardMessage = this._createMessage(
            'twitch',
            message.username,
            message.message,
            message.color,
            message.subscriber,
            message.mod
          );
          standardMessage.emotes = message.emotes;
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

    // Extract mod and subscriber status from tags.
    // The broadcaster does not get mod=1 — detect them via the broadcaster badge.
    const broadcaster = /badges=[^;\s]*broadcaster\/\d+/.test(line);
    const mod = broadcaster || /;mod=1[;\s]/.test(line);
    const subscriber = /;subscriber=1[;\s]/.test(line);

    // Extract emotes from tags (format: emotes=id:start-end,start-end/id:start-end)
    const emotes = [];
    const emotesMatch = line.match(/emotes=([^;\s]+)/);
    if (emotesMatch && emotesMatch[1]) {
      const emotesStr = emotesMatch[1];
      if (emotesStr.length > 0) {
        emotesStr.split('/').forEach(emoteEntry => {
          const [id, positions] = emoteEntry.split(':');
          if (id && positions) {
            positions.split(',').forEach(pos => {
              const [start, end] = pos.split('-').map(Number);
              emotes.push({ id, start, end });
            });
          }
        });
      }
    }

    if (messageMatch && userMatch) {
      const text = messageMatch[1];
      return {
        username: userMatch[1],
        message: text,
        color: color,
        mod: mod,
        subscriber: subscriber,
        emotes: emotes.map(e => ({
          id: e.id,
          name: text.substring(e.start, e.end + 1),
          url: `https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/default/dark/3.0`
        }))
      };
    }
    return null;
  }
}
