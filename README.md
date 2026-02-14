# Stream Overlays Framework

A lightweight framework for creating interactive stream overlays that respond to Twitch and Kick chat messages.

## Features

- 🎮 Multi-platform support (Twitch & Kick)
- 🚀 Lightweight vanilla JavaScript (no frameworks required)
- 🎨 Easy to extend for custom overlays
- 📦 Modular architecture
- 🔌 Simple event-based system

## Quick Start

### Add to OBS

1. Add a new **Browser Source** in OBS
2. Set the URL with your channel name(s):
   ```
   file:///C:/path/to/stream-overlays/src/overlays/emoji-rain/index.html?twitch=your_channel
   ```
3. Set Width: `1920` and Height: `1080` (or your stream resolution)
4. Done! Type emojis in chat to see them fall

**Multiple platforms:**
```
?twitch=your_channel&kick=your_kick_channel
```

**Debug mode:**
```
?twitch=your_channel&debug=true
```

## Included Overlays

### Emoji Rain

Emojis and emotes from chat fall from top to bottom like rain.

**URL:**
```
file:///C:/path/to/stream-overlays/src/overlays/emoji-rain/index.html?twitch=your_channel
```

**URL Parameters:**
- `twitch=channel_name` - Twitch channel to connect to
- `kick=channel_name` - Kick channel to connect to
- `debug=true` - Show debug info overlay
- `fallDuration=5000` - Fall duration in ms (default: 5000)
- `fontSize=48` - Emoji size in pixels (default: 48)

**Features:**
- Works with Unicode emojis (🎮💜) from both platforms
- Works with Kick custom emotes (KEKW, etc.) as images
- Customizable fall speed and size

### Matrix

Matrix-style falling code effect with chat messages mixed in.

**URL:**
```
file:///C:/path/to/stream-overlays/src/overlays/matrix/index.html?twitch=your_channel
```

**URL Parameters:**
- `twitch=channel_name` - Twitch channel to connect to
- `kick=channel_name` - Kick channel to connect to
- `debug=true` - Show debug info overlay
- `fontSize=16` - Character size in pixels (default: 16)
- `speed=50` - Animation speed in ms (default: 50, lower = faster)
- `columnWidth=20` - Width of each column in pixels (default: 20)

**Features:**
- Classic Matrix green-on-black aesthetic
- Chat messages appear in the falling code
- Fills with random characters when chat is slow
- Katakana and Latin characters
- Adjustable speed and density

## Creating Custom Overlays

### 1. Create Your Overlay Class

```javascript
import { BaseOverlay } from '../../core/base-overlay.js';

export class MyCustomOverlay extends BaseOverlay {
  onMessage(message) {
    // message: { platform, username, message, color, timestamp }
    console.log(`${message.username}: ${message.message}`);
  }
}
```

### 2. Create the HTML File

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My Custom Overlay</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="overlay-container"></div>

  <script type="module">
    import { MyCustomOverlay } from './overlay.js';

    async function init() {
      const params = new URLSearchParams(window.location.search);
      const config = {
        twitch: { enabled: !!params.get('twitch'), channel: params.get('twitch') || '' },
        kick: { enabled: !!params.get('kick'), channel: params.get('kick') || '' },
        settings: {}
      };

      const overlay = new MyCustomOverlay(config);
      await overlay.init();
    }

    init();
  </script>
</body>
</html>
```

### BaseOverlay API

**Methods to override:**
- `onInit()` - Called when overlay is ready
- `onMessage(message)` - Called for each chat message

**Utility methods:**
- `createAnimatedElement(element, animationName, duration, onComplete)`

**Properties:**
- `this.config` - Configuration object
- `this.container` - Main overlay container element
- `this.clients` - Array of connected chat clients

### Message Object

```javascript
{
  platform: 'twitch' | 'kick',
  username: 'string',
  message: 'string',
  color: '#FF0000' | null,  // User's chat color
  timestamp: 1234567890
}
```

## Examples

### Filter by Platform
```javascript
onMessage(message) {
  if (message.platform === 'twitch') {
    // Twitch-only logic
  }
}
```

### Trigger on Keywords
```javascript
onMessage(message) {
  if (message.message.includes('!drop')) {
    this.spawnDrop();
  }
}
```

### Extract Emojis
```javascript
import { extractEmojis } from '../../utils/emoji-parser.js';

onMessage(message) {
  const emojis = extractEmojis(message.message);
  emojis.forEach(emoji => this.animate(emoji));
}
```

## Project Structure

```
stream-overlays/
├── src/
│   ├── core/
│   │   ├── base-overlay.js      # Base class for all overlays
│   │   ├── chat-client.js       # Abstract chat client
│   │   ├── twitch-client.js     # Twitch IRC integration
│   │   ├── kick-client.js       # Kick Pusher integration
│   │   └── event-emitter.js     # Event system
│   ├── overlays/
│   │   ├── emoji-rain/          # Emoji falling overlay
│   │   └── matrix/              # Matrix code overlay
│   └── utils/
│       └── emoji-parser.js      # Emoji/emote extraction utilities
└── README.md
```

## More Overlay Ideas

- 💬 Scrolling text marquee
- 🎯 Click target game with chat emojis
- 🌊 Particle effects triggered by chat
- 📊 Live polls and voting
- 🎁 Alert animations for follows/subs
- 🎲 Random selection wheel
- 🏆 Chat activity leaderboard
- 🔥 Word cloud from chat messages
- 🎵 Music visualizer synced to chat activity

## Technical Notes

**Kick Chat Implementation:**
This uses a vanilla Pusher WebSocket implementation for browser compatibility. The [@retconned/kick-js](https://github.com/retconned/kick-js) library exists but is Node.js-only and won't work in browsers/OBS.

## Troubleshooting

**Overlay not showing in OBS:**
- Use full file path starting with `file:///`
- Check OBS browser console (right-click source → Interact → F12)

**Not receiving messages:**
- Verify channel name in URL or config
- Check browser console for errors
- Ensure channel has active chat

**Emojis not working:**
- Use unicode emojis (🎮💜), not text codes (:smile:)
- Add `?debug=true` to URL to verify messages are received

## How It Works

1. **Chat Clients**: Connect to Twitch (IRC WebSocket) and Kick (Pusher)
2. **Event System**: Standardizes messages from different platforms
3. **Base Overlay**: Manages connections and lifecycle
4. **Your Overlay**: Extends BaseOverlay to implement custom behavior

Built with vanilla JavaScript - no build tools, no dependencies, just works in OBS.

## License

MIT - Use however you'd like!
