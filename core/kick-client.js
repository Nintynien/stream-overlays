import { ChatClient } from './chat-client.js';

/**
 * Kick chat client using direct Pusher WebSocket connection
 *
 * Note: @retconned/kick-js library exists but is Node.js-only
 * This vanilla implementation works in browsers/OBS
 */
export class KickClient extends ChatClient {
  constructor(config) {
    super(config);
    this.ws = null;
    this.channelId = config.channelId;
    this.channelName = config.channelName || config.channel;
    this.userId = null;
    this.pusherConfig = null;
  }

  async connect() {
    // Look up channel ID from name if needed
    if (this.channelName && !this.channelId) {
      try {
        this.channelId = await this._lookupChannelId(this.channelName);
      } catch (error) {
        console.error('[Kick] Failed to lookup channel:', error);
        throw new Error(`Could not find Kick channel: ${this.channelName}`);
      }
    }

    if (!this.channelId) {
      throw new Error('Kick channel name or ID is required');
    }

    // Get Pusher configuration
    try {
      this.pusherConfig = await this._getPusherConfig();
    } catch (error) {
      console.error('[Kick] Failed to get Pusher config:', error);
      throw error;
    }

    // Connect to Pusher WebSocket
    return new Promise((resolve, reject) => {
      const wsUrl = `wss://ws-${this.pusherConfig.cluster}.pusher.com/app/${this.pusherConfig.key}?protocol=7&client=js&version=7.0.3`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this._subscribe();
        this.connected = true;
        this.emit('connected', { platform: 'kick' });
        resolve();
      };

      this.ws.onmessage = (event) => {
        this._handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('[Kick] WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = (event) => {
        console.log('[Kick] WebSocket closed - Code:', event.code);
        this.connected = false;
        this.emit('disconnected', { platform: 'kick' });
      };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  _subscribe() {
    // Subscribe to chatroom channel (requires .v2 suffix for messages)
    const channel = `chatrooms.${this.channelId}.v2`;
    const subscribeMessage = {
      event: 'pusher:subscribe',
      data: {
        auth: '',
        channel: channel
      }
    };

    this.ws.send(JSON.stringify(subscribeMessage));
  }

  _handleMessage(rawMessage) {
    try {
      const data = JSON.parse(rawMessage);
      this._log('[Kick]', data.event, data.data);

      // Connection established
      if (data.event === 'pusher:connection_established') {
        console.log('[Kick] Connected');
        return;
      }

      // Ping/pong (silent)
      if (data.event === 'pusher:ping') {
        this.ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
        return;
      }

      // Subscription success
      if (data.event === 'pusher_internal:subscription_succeeded') {
        console.log('[Kick] Subscribed to channel');
        return;
      }

      // Subscription error
      if (data.event === 'pusher:error' || data.event === 'pusher_internal:subscription_error') {
        console.error('[Kick] Subscription error:', data.data?.message || data);
        return;
      }

      // Check for subscription requiring auth
      if (data.channel && (data.channel.startsWith('private-') || data.channel.startsWith('presence-'))) {
        console.error('[Kick] Channel requires authentication');
        return;
      }

      // Chat messages
      if (data.event.includes('ChatMessage')) {
        const messageData = JSON.parse(data.data);
        const standardMessage = this._createMessage(
          'kick',
          messageData.sender?.username || 'Anonymous',
          messageData.content,
          messageData.sender?.identity?.color || null,
          messageData.sender?.identity?.badges?.some(
            badge => badge.type === 'subscriber'
          ),
          messageData.sender?.identity?.badges?.some(
            badge => badge.type === 'moderator' || badge.type === 'broadcaster'
          ),
        );
        this.emit('message', standardMessage);
        return;
      }

      // Silently ignore other events (subscriptions, message deletes, etc.)
    } catch (error) {
      console.error('[Kick] Error parsing message:', error);
    }
  }

  async _lookupChannelId(channelName) {
    const response = await fetch(`https://kick.com/api/v2/channels/${channelName}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Store user ID for external services (e.g. 7TV)
    this.userId = data.user_id || data.id;

    // Kick has both channel.id and chatroom.id - we need chatroom.id
    const chatroomId = data.chatroom?.id || data.id;

    if (!chatroomId) {
      throw new Error('Chatroom ID not found in response');
    }

    return chatroomId;
  }

  async _getPusherConfig() {
    // Try to fetch from Kick's settings API
    try {
      const response = await fetch('https://kick.com/api/v1/settings');

      if (response.ok) {
        const data = await response.json();
        if (data.pusher?.key && data.pusher?.cluster) {
          return {
            key: data.pusher.key,
            cluster: data.pusher.cluster
          };
        }
      }
    } catch (error) {
      // Silently fall back to hardcoded config
    }

    // Fallback to known working config
    return {
      key: '32cbd69e4b950bf97679',
      cluster: 'us2'
    };
  }
}
