/**
 * Utility functions for extracting emojis from text
 */

/**
 * Extract all unicode emojis from a string
 * @param {string} text - The text to parse
 * @returns {string[]} Array of emojis found
 */
export function extractEmojis(text) {
  // Unicode emoji regex (covers most common emoji ranges)
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  const matches = text.match(emojiRegex);
  return matches || [];
}

/**
 * Extract Kick custom emotes from text
 * @param {string} text - The text to parse
 * @returns {Array<{id: string, name: string, url: string}>} Array of Kick emotes
 */
export function extractKickEmotes(text) {
  // Match Kick emote format: [emote:ID:NAME]
  const emoteRegex = /\[emote:(\d+):([^\]]+)\]/g;
  const emotes = [];
  let match;

  while ((match = emoteRegex.exec(text)) !== null) {
    emotes.push({
      id: match[1],
      name: match[2],
      url: `https://files.kick.com/emotes/${match[1]}/fullsize`
    });
  }

  return emotes;
}

/**
 * Extract all emojis and emotes from a chat message
 * @param {Object} message - Standardized chat message object
 * @param {string} message.message - The message text
 * @param {string} message.platform - Platform ('twitch', 'kick', etc.)
 * @param {Array<{id: string, name: string, url: string}>} [message.emotes] - Pre-parsed emotes (e.g. from Twitch IRC tags)
 * @returns {Array<{type: 'emoji'|'emote', content: string, url?: string}>} Array of emojis/emotes
 */
export function extractAllEmojis(message) {
  const results = [];

  // Extract Unicode emojis
  const unicodeEmojis = extractEmojis(message.message);
  unicodeEmojis.forEach(emoji => {
    results.push({ type: 'emoji', content: emoji });
  });

  // Extract Kick custom emotes
  if (message.platform === 'kick') {
    const kickEmotes = extractKickEmotes(message.message);
    kickEmotes.forEach(emote => {
      results.push({
        type: 'emote',
        content: emote.name,
        url: emote.url
      });
    });
  }

  // Use pre-parsed emotes from Twitch IRC tags (deduplicated by ID)
  if (message.platform === 'twitch' && message.emotes?.length > 0) {
    const seen = new Set();
    message.emotes.forEach(emote => {
      if (!seen.has(emote.id)) {
        seen.add(emote.id);
        results.push({
          type: 'emote',
          content: emote.name,
          url: emote.url
        });
      }
    });
  }

  return results;
}

/**
 * Check if a string contains any emojis
 * @param {string} text - The text to check
 * @returns {boolean}
 */
export function hasEmojis(text) {
  return extractEmojis(text).length > 0;
}

/**
 * Remove all emojis from a string
 * @param {string} text - The text to clean
 * @returns {string}
 */
export function removeEmojis(text) {
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  return text.replace(emojiRegex, '').trim();
}
