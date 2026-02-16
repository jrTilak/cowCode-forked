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

/**
 * Sock-like object for runAgentWithSkills and sendMessage compatibility.
 * sendMessage(chatId, { text }) -> bot.sendMessage(chatId, text)
 */
export function createTelegramSock(telegramBot) {
  if (!telegramBot) return null;
  return {
    sendMessage: async (chatId, opts) => {
      const text = opts?.text ?? '';
      const sent = await telegramBot.sendMessage(chatId, text);
      return { key: { id: sent.message_id?.toString?.() ?? 'tg-' + Date.now() } };
    },
    sendPresenceUpdate: () => {},
    user: { id: 'telegram' },
  };
}
