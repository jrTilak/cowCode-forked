/**
 * Telegram bot: sock-like interface so the same agent/cron flow can send to Telegram.
 * Set TELEGRAM_BOT_TOKEN in env (or in ~/.cowcode/.env) to enable.
 */

import TelegramBot from 'node-telegram-bot-api';

let bot = null;

/**
 * @param {string} token - Bot token from @BotFather
 * @returns {TelegramBot}
 */
export function initBot(token) {
  if (!token || !String(token).trim()) return null;
  bot = new TelegramBot(token.trim(), { polling: true });
  bot.on('polling_error', (err) => {
    const msg = err?.message || String(err);
    if (msg.includes('409') || msg.includes('Conflict') || msg.includes('getUpdates')) {
      console.log('[Telegram] Another cowCode is already using this bot; this process won\'t get Telegram messages. To use this process instead, stop the other: cowcode moo stop');
      bot.stopPolling().catch(() => {});
    } else {
      console.log('[Telegram] Connection issue:', msg.slice(0, 80) + (msg.length > 80 ? '…' : ''));
    }
  });
  return bot;
}

export function getBot() {
  return bot;
}

/** Telegram chat IDs are numeric (user) or negative (groups). WhatsApp JIDs contain '@'. */
export function isTelegramChatId(jid) {
  if (jid == null) return false;
  const s = String(jid).trim();
  return /^-?\d+$/.test(s);
}

/** True if jid is a Telegram group/supergroup (negative chat id). Used to keep group log/memory separate from main. */
export function isTelegramGroupJid(jid) {
  if (jid == null) return false;
  const n = parseInt(String(jid).trim(), 10);
  return !Number.isNaN(n) && n < 0;
}

/**
 * Sock-like object for runAgentWithSkills and sendMessage compatibility.
 * sendMessage(chatId, { text }) -> bot.sendMessage(chatId, text)
 * sendMessage(chatId, { voice: buffer }) -> bot.sendVoice(chatId, buffer) for voice replies
 */
export function createTelegramSock(telegramBot) {
  if (!telegramBot) return null;
  return {
    sendMessage: async (chatId, opts) => {
      if (opts?.voice && Buffer.isBuffer(opts.voice)) {
        const sent = await telegramBot.sendVoice(chatId, opts.voice, { filename: 'reply.ogg' });
        return { key: { id: sent.message_id?.toString?.() ?? 'tg-' + Date.now() } };
      }
      const text = opts?.text ?? '';
      const sent = await telegramBot.sendMessage(chatId, text);
      return { key: { id: sent.message_id?.toString?.() ?? 'tg-' + Date.now() } };
    },
    sendPresenceUpdate: () => {},
    user: { id: 'telegram' },
  };
}
