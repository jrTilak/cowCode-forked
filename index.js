/**
 * WhatsApp + configurable LLM. On incoming message → LLM reply → send back.
 * Config and state live in ~/.cowcode (or COWCODE_STATE_DIR).
 */

import { getAuthDir, getCronStorePath, getConfigPath, getEnvPath, ensureStateDir, getWorkspaceDir } from './lib/paths.js';
import dotenv from 'dotenv';

dotenv.config({ path: getEnvPath() });

import * as Baileys from '@whiskeysockets/baileys';

const makeWASocket =
  typeof Baileys.makeWASocket === 'function' ? Baileys.makeWASocket : Baileys.default;
const {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  extractMessageContent,
  areJidsSameUser,
} = Baileys;
import { chat as llmChat, chatWithTools, classifyIntent, loadConfig } from './llm.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import pino from 'pino';
import { startCron, stopCron, scheduleOneShot } from './cron/runner.js';
import { getSkillsEnabled, getSkillContext } from './skills/loader.js';
import { executeSkill } from './skills/executor.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const qrcodeTerminal = require('qrcode-terminal');

const __dirname = dirname(fileURLToPath(import.meta.url));

if (typeof makeWASocket !== 'function') {
  throw new Error('Baileys makeWASocket not found. Check @whiskeysockets/baileys version.');
}

const authOnly = process.argv.includes('--auth-only');
const pairIndex = process.argv.indexOf('--pair');
const pairNumber = pairIndex !== -1 ? process.argv[pairIndex + 1] : null;

// In auth mode show connection errors so we can see why linking fails
const logger = pino({ level: authOnly ? 'error' : 'silent' });

const DISCONNECT_REASONS = {
  401: 'Logged out',
  403: 'Forbidden (e.g. banned)',
  408: 'Connection lost / timed out',
  411: 'Multi-device not enabled (enable in WhatsApp Settings → Linked devices)',
  428: 'Connection closed',
  440: 'Connection replaced (another client linked)',
  500: 'Bad session',
  503: 'WhatsApp service unavailable',
  515: 'Restart required (reconnecting…)',
};

const RESTART_REQUIRED_CODE = 515;

/**
 * @param {{ continueToBot?: boolean }} opts - If true, after link we continue to run the bot (no exit).
 */
async function runAuthOnly(opts = {}) {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(getAuthDir());

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    logger,
  });

  sock.ev.on('creds.update', saveCreds);

  return new Promise((resolve, reject) => {
    sock.ev.on('connection.update', async (u) => {
      if (u.connection === 'open') {
        if (opts.continueToBot) {
          console.log('[connection] connection successful');
          console.log('Please send a message to your own number to get started.');
        } else {
          console.log('[connection] connection successful');
          console.log('Linked. You can Ctrl+C and run cowcode moo start.');
        }
        resolve(sock);
        return;
      }
      if (u.connection === 'close' && u.lastDisconnect) {
        const err = u.lastDisconnect.error;
        const code = err?.output?.statusCode ?? err?.statusCode;
        const reason = DISCONNECT_REASONS[code] || `Code ${code}`;
        if (code === RESTART_REQUIRED_CODE) {
          try { sock.end(undefined); } catch (_) {}
          resolve('restart');
          return;
        }
        reject(new Error(reason));
        return;
      }
      if (u.qr) {
        qrcodeTerminal.generate(u.qr, { small: true });
        console.log('Scan with WhatsApp (Linked devices).');
      }
    });

    if (pairNumber) {
      const digits = pairNumber.replace(/\D/g, '');
      if (digits.length < 10) {
        reject(new Error('Usage: pnpm run auth -- --pair <full-phone-number> (e.g. 1234567890)'));
        return;
      }
      sock.requestPairingCode(digits)
        .then((code) => {
          console.log('Pairing code (enter in WhatsApp → Linked devices → Link with phone number):', code);
        })
        .catch((e) => reject(e));
    }
  });
}

/** One-time migration: add "memory" to skills.enabled if missing so updates get the new default. */
function migrateSkillsConfigToIncludeMemory() {
  try {
    const path = getConfigPath();
    if (!existsSync(path)) return;
    const raw = readFileSync(path, 'utf8');
    const config = JSON.parse(raw);
    const skills = config.skills;
    if (!skills || typeof skills !== 'object') return;
    const enabled = Array.isArray(skills.enabled) ? skills.enabled : [];
    if (enabled.includes('memory')) return;
    enabled.push('memory');
    config.skills = { ...skills, enabled };
    writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
  } catch (_) {}
}

async function main() {
  ensureStateDir();
  migrateSkillsConfigToIncludeMemory();
  if (authOnly && existsSync(getAuthDir())) {
    rmSync(getAuthDir(), { recursive: true });
    mkdirSync(getAuthDir(), { recursive: true });
  }

  if (authOnly) {
    while (true) {
      try {
        const result = await runAuthOnly();
        if (result !== 'restart') break;
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        console.error(e.message);
        process.exit(1);
      }
    }
    return;
  }

  let sock;
  const credsPath = join(getAuthDir(), 'creds.json');
  const needAuth = !existsSync(getAuthDir()) || !existsSync(credsPath);

  // --test: use mock socket and skip WhatsApp auth so E2E tests can run without linking.
  if (process.argv.includes('--test')) {
    sock = {
      sendMessage: async () => ({ key: { id: 'test-' + Date.now() } }),
      sendPresenceUpdate: async () => {},
      readMessages: async () => {},
    };
  } else if (needAuth) {
    console.log('');
    console.log('  ─────────────────────────────────────────');
    console.log('  Link your WhatsApp');
    console.log('  ─────────────────────────────────────────');
    console.log('');
    console.log('  No session found. A QR code will appear below.');
    console.log('  Open WhatsApp → Linked devices → Link a device, then scan the code.');
    console.log('');
    while (true) {
      try {
        const result = await runAuthOnly({ continueToBot: true });
        if (result !== 'restart') {
          sock = result;
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        console.error(e.message);
        process.exit(1);
      }
    }
  } else {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(getAuthDir());
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
      },
      logger,
    });
    sock.ev.on('creds.update', saveCreds);
  }

  const config = loadConfig();
  const first = config.models[0];
  console.log('LLM config:', config.models.length > 1
    ? `${config.models.length} models (priority): ${config.models.map(m => m.model).join(' → ')}`
    : { baseUrl: first.baseUrl, model: first.model });
  const skillsEnabled = getSkillsEnabled();
  const { skillDocs, runSkillTool } = getSkillContext();
  console.log('Skills enabled:', skillsEnabled?.length ? skillsEnabled.join(', ') : 'cron (default)');

  const MAX_REPLIED_IDS = 500;
  const MAX_OUR_SENT_IDS = 200;
  const MAX_CHAT_HISTORY_EXCHANGES = 5;

  /** Last N exchanges (user + assistant) per jid for LLM context. Step 1: chat + history + tools. */
  const chatHistoryByJid = new Map();
  function getLast5Exchanges(jid) {
    const list = chatHistoryByJid.get(jid);
    if (!list || list.length === 0) return [];
    const out = [];
    for (const ex of list) {
      out.push({ role: 'user', content: ex.user });
      out.push({ role: 'assistant', content: ex.assistant });
    }
    return out;
  }
  function pushExchange(jid, userContent, assistantContent) {
    let list = chatHistoryByJid.get(jid);
    if (!list) list = [];
    list.push({ user: userContent, assistant: assistantContent });
    if (list.length > MAX_CHAT_HISTORY_EXCHANGES) list = list.slice(-MAX_CHAT_HISTORY_EXCHANGES);
    chatHistoryByJid.set(jid, list);
  }

  // Agent logic: LLM decides from skill docs; we only run what it returns (run_skill).
  const allTools = runSkillTool;
  const useSkills = Array.isArray(skillsEnabled) && skillsEnabled.length > 0 && allTools.length > 0;
  function getToolsForIntent() {
    return useSkills ? allTools : [];
  }
  const LANGUAGE_RULE = 'Reply ONLY in the same language as the user. If the user writes in English, reply in English. Do not reply in Spanish, Hindi, or any other language unless the user used that language first.';
  const CLARIFICATION_RULE = 'When information is missing or unclear (e.g. time, message, which option), or when a tool returns an error, do NOT show the error to the user. Instead reply with a short, friendly question asking for the missing or unclear detail (e.g. "Did you mean tomorrow at 9 or next week?", "What message should I send you?"). Keep the conversation going until you have everything needed—no silent failures, no raw errors.';
  const chatSystemPrompt = `You are a helpful assistant. ${LANGUAGE_RULE} Reply concisely. Do not use <think> or any thinking/reasoning blocks—output only your final reply.`;
  const skillDocsBlock = skillDocs
    ? `\n\n# Available skills (read these to decide when to use run_skill and which arguments to pass)\n\n${skillDocs}\n\n# Clarification\n${CLARIFICATION_RULE}`
    : '';
  function getBrowserSystemPrompt() {
    return `You are a helpful assistant with access to the browser tool to search the web or open a URL. ${LANGUAGE_RULE} Reply concisely. Do not use <think> or any thinking/reasoning blocks—output only your final reply.

Use the browser tool to get current information: call action "search" with "query" set to the user's search (e.g. current time, weather, recent trends, latest news). Then answer based on the returned content. If the user gave a specific URL, use action "navigate" with "url".

CRITICAL - Give the exact data in your reply:
- Time, weather, date: State the actual value from the results (e.g. "The time is 3:45 PM IST", "It's 28°C and sunny"). Do NOT say "check the link" or "search for it".
- News/headlines: When the user asks for top/latest news or headlines, LIST the actual headlines from the tool result (e.g. "1. Headline one. 2. Headline two. ..."). Do NOT reply with only a disclaimer (e.g. "headlines may change")—always include the list of headlines.

${CLARIFICATION_RULE}`;
  }
  function getScheduleSystemPrompt() {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const in1min = new Date(now + 60_000).toISOString();
    const in2min = new Date(now + 120_000).toISOString();
    const in3min = new Date(now + 180_000).toISOString();
    return `You are a helpful assistant with access to the cron tool for reminders. ${LANGUAGE_RULE} Reply concisely. Do not use <think> or any thinking/reasoning blocks—output only your final reply.

CRITICAL - Choose the right action:
- If the user only asks to LIST, SEE, COUNT, or ask WHAT/WHICH crons exist (e.g. "how many crons?", "what is the next cron?", "which crons are set?", "list my reminders", "what's scheduled?") → call the cron tool exactly ONCE with action "list". Do NOT call "add" in the same message.
- "Which crons are set?" means list existing crons, NOT create new ones. Use list only.
- Use "add" only when the user explicitly asks to CREATE or SET a new reminder (e.g. "remind me in 5 minutes", "send me X tomorrow").
- Use "remove" when the user asks to cancel/delete a specific job (by id).

Use the cron tool to add, list, or remove reminders as requested. For multiple reminders in one message, call the cron tool once per reminder. Each call must have a different schedule.at time.

Current time: ${nowIso}. Use future ISO 8601 for "at". Examples: "in 1 minute" = ${in1min}; "in 2 minutes" = ${in2min}; "in 3 minutes" = ${in3min}. For "every one minute for the next three minutes" you MUST call cron add THREE times: first at ${in1min}, second at ${in2min}, third at ${in3min}. Never use the same "at" for multiple jobs.

Important: job.message must be exactly what the user asked to receive (e.g. "fun fact" / "Give me a fun fact"—do not substitute "Hello, how can I assist").

${CLARIFICATION_RULE} If the user says "remind me" without when or what, ask e.g. "When should I remind you, and what message would you like?"`;
  }
  async function runAgentWithSkills(sock, jid, text, lastSentByJidMap, selfJidForCron, ourSentIdsRef) {
    console.log('[agent] runAgentWithSkills started for:', text.slice(0, 60));
    try {
      await sock.sendPresenceUpdate('composing', jid);
    } catch (_) {}
    let intent = 'CHAT';
    try {
      intent = await classifyIntent(text);
      console.log('[agent] intent:', intent);
    } catch (err) {
      console.error('[agent] intent classification failed:', err.message);
    }
    const toolsToUse = getToolsForIntent();
    const useTools = toolsToUse.length > 0;
    const isListOnly = intent === 'SCHEDULE_LIST';
    const isSearch = intent === 'SEARCH';
    const isMemoryOnly = useTools && intent === 'CHAT';
    if (useTools && !isListOnly && !isSearch && !isMemoryOnly) {
      const immediateReply = "[CowCode] Grazing on that…";
      const immediateSent = await sock.sendMessage(jid, { text: immediateReply });
      if (immediateSent?.key?.id && ourSentIdsRef?.current) {
        ourSentIdsRef.current.add(immediateSent.key.id);
        if (ourSentIdsRef.current.size > MAX_OUR_SENT_IDS) {
          const first = ourSentIdsRef.current.values().next().value;
          if (first) ourSentIdsRef.current.delete(first);
        }
      }
      lastSentByJidMap.set(jid, immediateReply);
      console.log('[replied] (immediate)');
    }
    const basePrompt = useTools
      ? (intent === 'SEARCH' ? getBrowserSystemPrompt() : intent === 'CHAT' ? chatSystemPrompt : getScheduleSystemPrompt())
      : chatSystemPrompt;
    const systemPrompt = useTools ? basePrompt + skillDocsBlock : basePrompt;
    const ctx = {
      storePath: getCronStorePath(),
      jid,
      workspaceDir: getWorkspaceDir(),
      scheduleOneShot,
      startCron: () => startCron({ sock, selfJid: selfJidForCron, storePath: getCronStorePath() }),
    };
    const historyMessages = getLast5Exchanges(jid);
    let messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: text },
    ];
    let finalContent = '';
    let cronListResult = null;
    let browserResult = null;
    let lastRoundHadToolError = false;
    const maxToolRounds = 3;
    for (let round = 0; round <= maxToolRounds; round++) {
      if (!useTools) {
        const rawReply = await llmChat(messages);
        finalContent = stripThinking(rawReply);
        break;
      }
      const { content, toolCalls } = await chatWithTools(messages, toolsToUse);
      if (!toolCalls || toolCalls.length === 0) {
        finalContent = content || '';
        break;
      }
      const assistantMsg = {
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
      messages = messages.concat(assistantMsg);
      lastRoundHadToolError = false;
      for (const tc of toolCalls) {
        let payload = {};
        try {
          payload = JSON.parse(tc.arguments || '{}');
        } catch {
          payload = {};
        }
        const skillId = payload.skill && String(payload.skill).trim();
        const runArgs = payload.arguments && typeof payload.arguments === 'object' ? payload.arguments : {};
        const toolName = skillId === 'memory' ? (runArgs.tool || 'memory_search') : undefined;
        const action = runArgs?.action && String(runArgs.action).trim().toLowerCase();
        if (!skillId) {
          const errContent = JSON.stringify({ error: 'run_skill requires "skill" and "arguments".' });
          lastRoundHadToolError = true;
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: errContent,
          });
          continue;
        }
        console.log('[agent] run_skill', skillId, tc.arguments?.slice(0, 80));
        const result = await executeSkill(skillId, ctx, runArgs, toolName);
        const isToolError = typeof result === 'string' && result.trim().startsWith('{"error":');
        if (isToolError) lastRoundHadToolError = true;
        if (skillId === 'cron' && action === 'list' && result && typeof result === 'string' && !isToolError) {
          cronListResult = result;
        }
        if (skillId === 'browser' && result && typeof result === 'string') {
          const newHasHeadlines = result.includes('Top news / headlines');
          const newIsError = result.trim().startsWith('{"error":') || result.includes('The search engine returned an error');
          const currentIsError = !browserResult || browserResult.trim().startsWith('{"error":') || browserResult.includes('The search engine returned an error');
          if (!browserResult || newHasHeadlines || (currentIsError && !newIsError)) browserResult = result;
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        });
      }
    }
    // If tools returned errors but the LLM never replied with text, ask the user for clarification (no raw errors).
    if (useTools && !stripThinking(finalContent).trim() && lastRoundHadToolError) {
      try {
        const { content: clarification } = await chatWithTools(messages, []);
        const text = clarification && stripThinking(clarification).trim();
        if (text) finalContent = text;
      } catch (err) {
        console.error('[agent] clarification round failed:', err.message);
      }
    }
    // For SEARCH: if we have search results but no LLM reply (e.g. model didn't synthesize), run one more call with no tools so the model answers with the exact data from the results.
    if (isSearch && browserResult && !stripThinking(finalContent).trim()) {
      try {
        const synthesized = await chatWithTools(messages, []);
        const reply = synthesized?.content && stripThinking(synthesized.content).trim();
        if (reply) finalContent = reply;
      } catch (err) {
        console.error('[agent] search synthesis failed:', err.message);
      }
    }
    // For SEARCH: prefer browserResult when the LLM returned tool-call JSON or a disclaimer without listing headlines.
    const trimmedFinal = stripThinking(finalContent).trim();
    const looksLikeToolCallJson = /"skill"\s*:|\"run_skill\"|"action"\s*:\s*"search"|"parameters"\s*:\s*\{/.test(trimmedFinal);
    const hasNumberedHeadlines = /\n\d+\.\s+.+/.test(trimmedFinal) || /^\d+\.\s+.+/.test(trimmedFinal);
    const browserHasNewsBlock = browserResult && browserResult.includes('Top news / headlines');
    const useBrowserResultForSearch = isSearch && browserResult && browserResult.trim() && (
      !trimmedFinal ||
      looksLikeToolCallJson ||
      (browserHasNewsBlock && !hasNumberedHeadlines)
    );
    let textToSend;
    if (useBrowserResultForSearch) {
      let browserReply = browserResult.trim();
      try {
        const parsed = JSON.parse(browserReply);
        if (parsed && typeof parsed.error === 'string') {
          const err = parsed.error;
          if (/executable doesn't exist|doesn't exist at|playwright.*install/i.test(err)) {
            browserReply = "I couldn't run the search because the browser isn't set up. Run: pnpm exec playwright install";
          } else {
            browserReply = 'Search failed: ' + err;
          }
        }
      } catch (_) {
        browserReply = browserReply.slice(0, 2000) + (browserReply.length > 2000 ? '…' : '');
      }
      textToSend = '[CowCode] ' + browserReply;
    } else if (trimmedFinal) {
      textToSend = '[CowCode] ' + trimmedFinal;
    } else if (cronListResult && cronListResult.trim()) {
      textToSend = '[CowCode] ' + cronListResult.trim();
    } else if (browserResult && browserResult.trim()) {
      let browserReply = browserResult.trim();
      try {
        const parsed = JSON.parse(browserReply);
        if (parsed && typeof parsed.error === 'string') {
          const err = parsed.error;
          if (/executable doesn't exist|doesn't exist at|playwright.*install/i.test(err)) {
            browserReply = "I couldn't run the search because the browser isn't set up. Run: pnpm exec playwright install";
          } else {
            browserReply = 'Search failed: ' + err;
          }
        }
      } catch (_) {
        browserReply = browserReply.slice(0, 2000) + (browserReply.length > 2000 ? '…' : '');
      }
      textToSend = '[CowCode] ' + browserReply;
    } else {
      textToSend = "[CowCode] Done. Anything else?";
    }
    // Never send raw error JSON to the user—keep the conversation going with a clarifying ask.
    const body = textToSend.replace(/^\[CowCode\]\s*/i, '').trim();
    if (body.startsWith('{"error":')) {
      textToSend = "[CowCode] I need a bit more detail—when should I remind you, and what message would you like?";
    }
    const sent = await sock.sendMessage(jid, { text: textToSend });
    if (sent?.key?.id && ourSentIdsRef?.current) {
      ourSentIdsRef.current.add(sent.key.id);
      if (ourSentIdsRef.current.size > MAX_OUR_SENT_IDS) {
        const first = ourSentIdsRef.current.values().next().value;
        if (first) ourSentIdsRef.current.delete(first);
      }
    }
    lastSentByJidMap.set(jid, textToSend);
    pushExchange(jid, text, textToSend);
    console.log('[replied]', useTools ? '(agent + skills)' : '(chat)');
  }

  // --test: run main code path once with mock socket (set above), then exit. No WhatsApp auth.
  // E2E tests capture stdout and parse E2E_REPLY_START...E2E_REPLY_END to assert on the reply.
  if (process.argv.includes('--test')) {
    const testIdx = process.argv.indexOf('--test');
    const testMsg = process.argv[testIdx + 1] || process.env.TEST_MESSAGE || 'Send me hello in 1 minute';
    const lastSent = new Map();
    const sentIds = { current: new Set() };
    console.log('[test] Running main code path with message:', testMsg.slice(0, 60));
    await runAgentWithSkills(sock, 'test@s.whatsapp.net', testMsg, lastSent, 'test@s.whatsapp.net', sentIds);
    const reply = lastSent.get('test@s.whatsapp.net');
    if (reply != null) {
      console.log('E2E_REPLY_START');
      console.log(reply);
      console.log('E2E_REPLY_END');
    }
    console.log('[test] Done. Check cron/jobs.json.');
    process.exit(0);
  }

  console.log('');
  console.log('  ─────────────────────────────────────────');
  console.log('  Connecting to WhatsApp');
  console.log('  ─────────────────────────────────────────');
  console.log('');
  sock.ev.on('connection.update', (u) => {
    if (u.connection === 'open') {
      console.log('  [connection] connection successful');
      const sid = sock.user?.id ?? selfJid;
      if (sid) selfJid = sid;
      console.log('  WhatsApp connected. Message your own number to start chatting.');
      console.log('');
      if (sid) {
        startCron({ sock, selfJid: sid, storePath: getCronStorePath() });
      }
    }
    if (u.connection === 'close') {
      stopCron();
      const reason = u.lastDisconnect?.error;
      const code = reason?.output?.statusCode ?? reason?.statusCode;
      const msg = reason?.message || reason?.output?.payload?.message;
      const why = DISCONNECT_REASONS[code] || (code != null ? `Code ${code}` : 'unknown');
      console.log('WhatsApp disconnected:', why);
      if (msg) console.log('  →', msg);
      if (code === 401 || code === 403 || code === 428) {
        console.log('  → Run: pnpm run auth   to re-link your device.');
      }
    }
  });

  // Message flow: intercept incoming → immediate reply → schedule/LLM in background.
  let selfJid = sock.user?.id;
  sock.ev.on('creds.update', () => { selfJid = sock.user?.id; });
  const repliedIds = new Set();
  const lastSentByJid = new Map();
  const ourSentMessageIds = new Set(); // IDs of messages we sent (to ignore echo in self-chat)

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages ?? []) {
      if (!m.key?.remoteJid) continue;
      if (isJidBroadcast(m.key.remoteJid)) continue;

      selfJid = selfJid ?? sock.user?.id;
      const jid = m.key.remoteJid;

      // Only respond in self-chat (saved messages): from us and chat is with ourselves. Ignore all other chats.
      if (!m.key.fromMe) continue;
      if (!selfJid || !areJidsSameUser(jid, selfJid)) continue;

      const content = extractMessageContent(m.message);
      const text = (content?.conversation || content?.extendedTextMessage?.text || '').trim();
      if (!text) continue;

      // Do not treat our own CowCode replies as user input.
      if (text.startsWith('[CowCode]')) continue;

      // Skip only when this is clearly our echo: fromMe and the text exactly matches what we last sent to this chat.
      const lastWeSent = lastSentByJid.get(jid);
      if (m.key.fromMe && typeof lastWeSent === 'string' && text === lastWeSent) {
        console.log('[skip] our echo (fromMe, text matches last sent)');
        continue;
      }

      const msgKey = m.key.id ? `${jid}:${m.key.id}` : null;
      if (msgKey && repliedIds.has(msgKey)) {
        console.log('[skip] already replied to this message id');
        continue;
      }
      if (msgKey) {
        repliedIds.add(msgKey);
        if (repliedIds.size > MAX_REPLIED_IDS) {
          const first = repliedIds.values().next().value;
          if (first) repliedIds.delete(first);
        }
      }

      console.log('[incoming]', text.slice(0, 60) + (text.length > 60 ? '…' : ''));
      try {
        if (m.key.id) {
          try {
            await sock.readMessages([{ remoteJid: jid, id: m.key.id, participant: m.key.participant, fromMe: false }]);
          } catch (_) {}
        }

        runAgentWithSkills(sock, jid, text, lastSentByJid, selfJid ?? sock.user?.id, { current: ourSentMessageIds }).catch((err) => {
          console.error('Background agent error:', err.message);
          sock.sendMessage(jid, { text: `[CowCode] Moo — something went wrong: ${err.message}` }).catch(() => {});
        });
      } catch (err) {
        console.error('LLM error:', err.message);
        await sock.sendMessage(jid, { text: `[CowCode] Moo — something went wrong: ${err.message}` });
      }
    }
  });
}

function stripThinking(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .replace(/<\/think>/gi, '')
    .trim();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
