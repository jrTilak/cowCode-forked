/**
 * Group-only guard: rate limiting and drastic-action approval for Telegram groups.
 * These checks run only when the chat is a group (not in one-on-one / private chats).
 */

/** Telegram: group and supergroup chats have negative chat.id; private chats have positive. */
const TG_GROUP_TYPES = new Set(['group', 'supergroup']);

/**
 * Only true for group/supergroup. Private chats return false — no guard logic there.
 * @param {{ type?: string, id?: number }} chat - msg.chat from Telegram
 * @returns {boolean}
 */
export function isTelegramGroup(chat) {
  if (!chat) return false;
  if (TG_GROUP_TYPES.has(chat.type)) return true;
  if (typeof chat.id === 'number' && chat.id < 0) return true;
  return false;
}

/** Cron/schedule/remind: not allowed for non-owners in groups (no approval path). */
const CRON_PATTERNS = [
  /\b(schedule|remind|set a reminder|cron|set cron)\b/i,
  /\b(remind me|send me .* (in|at|tomorrow))\b/i,
];

/** Patterns that suggest a "drastic" request: run commands, edit files, browse, external services. Cron is handled separately (not allowed for non-owners). */
const DRASTIC_PATTERNS = [
  /\b(run|execute|shell|command line|terminal)\b.*\b(command|cmd|bash|sh)\b/i,
  /\b(run|execute)\s+(ls|cat|cd|rm|mv|cp|chmod|npm|node|python|git)\b/i,
  /\b(edit|change|modify|patch)\s+(file|files|code|config)\b/i,
  /\b(write|create|save)\s+(file|files|to disk)\b/i,
  /\b(browse|open|navigate)\s+(to|the)\s+(web|url|site)\b/i,
  /\b(go to|navigate to)\s+https?:\/\//i,
  /\b(google|gmail|calendar)\b/i,
  /\b(apply patch|apply this patch)\b/i,
];

/**
 * True if the message is about creating or managing cron/schedule/reminders. Non-owners in groups are not allowed to use cron (blocked, no approval).
 * @param {string} text - User message
 * @returns {boolean}
 */
export function isCronIntent(text) {
  const t = (text || '').trim();
  if (!t) return false;
  return CRON_PATTERNS.some((re) => re.test(t));
}

/**
 * Heuristic: does the message likely ask for a high-impact action (run code, edit files, browse, etc.)?
 * Used only in groups to decide if we need bot owner approval before running the agent (owner = config, not group admin).
 * @param {string} text - User message
 * @returns {boolean}
 */
export function isDrasticIntent(text) {
  const t = (text || '').trim();
  if (!t) return false;
  return DRASTIC_PATTERNS.some((re) => re.test(t));
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 5;

/** @type {Map<string, number[]>} key -> sorted timestamps of requests */
const rateBuckets = new Map();

function pruneOld(key) {
  const list = rateBuckets.get(key);
  if (!list) return;
  const cutoff = Date.now() - RATE_WINDOW_MS;
  const kept = list.filter((ts) => ts > cutoff);
  if (kept.length === 0) rateBuckets.delete(key);
  else rateBuckets.set(key, kept);
}

/**
 * Rate limit: only meaningful in groups. Returns true if this (group) requester is over limit.
 * @param {string} key - e.g. `${chatId}:${fromId}`
 * @returns {boolean} true if over limit (should block and tell user to wait or ask bot owner)
 */
export function isOverRateLimit(key) {
  pruneOld(key);
  const list = rateBuckets.get(key) || [];
  return list.length >= RATE_MAX_REQUESTS;
}

/**
 * Record one request for rate limiting. Call only when we're about to run the agent (group, non-owner).
 * @param {string} key - same as for isOverRateLimit
 */
export function recordGroupRequest(key) {
  const list = rateBuckets.get(key) || [];
  list.push(Date.now());
  rateBuckets.set(key, list);
  pruneOld(key);
}

/** One pending approval per owner: { groupJid, groupTitle?, fromId, fromUsername?, fromName?, userMessage, createdAt } */
let pendingByOwnerId = null;

/**
 * Set pending approval request (group member asked something drastic). Only used when chat is a group.
 * @param {number} ownerTelegramId
 * @param {{ groupJid: string, groupTitle?: string, fromId: number, fromUsername?: string, fromName?: string, userMessage: string }} data
 */
export function setPendingApproval(ownerTelegramId, data) {
  pendingByOwnerId = { ownerId: ownerTelegramId, ...data, createdAt: Date.now() };
}

/**
 * @param {number} ownerTelegramId
 * @returns {{ groupJid: string, groupTitle?: string, fromId: number, fromUsername?: string, fromName?: string, userMessage: string } | null}
 */
export function getPendingApproval(ownerTelegramId) {
  if (!pendingByOwnerId || pendingByOwnerId.ownerId !== ownerTelegramId) return null;
  return pendingByOwnerId;
}

/** Clear pending after owner approves or denies. */
export function clearPendingApproval(ownerTelegramId) {
  if (pendingByOwnerId && pendingByOwnerId.ownerId === ownerTelegramId) pendingByOwnerId = null;
}
