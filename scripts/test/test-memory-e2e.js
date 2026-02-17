/**
 * E2E tests for memory: chat log is written, and (when embedding is available) memory recall works.
 * Uses temp state dir; ensures memory is enabled in config. Two tests:
 * 1. Chat log written — one message → assert workspace/chat-log/YYYY-MM-DD.jsonl contains the exchange.
 * 2. Memory recall — store a distinct phrase, then ask "what was the phrase?" and assert reply contains it.
 *    Requires embedding API; if embedding fails, the recall test may fail (index not updated).
 */

import { spawn } from 'child_process';
import { readFileSync, mkdirSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir, tmpdir } from 'os';
import { runSkillTests } from './skill-test-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const INSTALL_ROOT = process.env.COWCODE_INSTALL_DIR ? resolve(process.env.COWCODE_INSTALL_DIR) : ROOT;
const DEFAULT_STATE_DIR = join(homedir(), '.cowcode');

const E2E_REPLY_MARKER_START = 'E2E_REPLY_START';
const E2E_REPLY_MARKER_END = 'E2E_REPLY_END';
const PER_TEST_TIMEOUT_MS = 120_000;

/** Unique phrase we store then ask for; must be unlikely to appear by chance. */
const MEMORY_RECALL_PHRASE = 'COWCODE_E2E_MAGIC_42';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Create temp state dir with memory enabled. Copies config.json and .env from default state;
 * ensures skills.enabled includes 'memory'. Creates workspace dir.
 * @returns {{ stateDir: string, workspaceDir: string }}
 * @throws {Error} If no config.json in default state or config has no LLM models (tests need a working LLM).
 */
function createTempStateDir() {
  const stateDir = join(tmpdir(), 'cowcode-memory-e2e-' + Date.now());
  const workspaceDir = join(stateDir, 'workspace');
  const memoryDir = join(stateDir, 'memory');
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });

  const defaultConfigPath = join(DEFAULT_STATE_DIR, 'config.json');
  if (!existsSync(defaultConfigPath)) {
    throw new Error('No config at ' + DEFAULT_STATE_DIR + '. Run setup first; memory E2E needs a working LLM.');
  }
  const raw = readFileSync(defaultConfigPath, 'utf8').trim();
  let config = {};
  try {
    config = JSON.parse(raw);
  } catch (_) {}
  const models = config.llm && Array.isArray(config.llm.models) ? config.llm.models : [];
  if (models.length === 0) {
    throw new Error('config.json has no llm.models. Memory E2E needs at least one LLM (and API key in .env).');
  }
  const skills = config.skills && typeof config.skills === 'object' ? config.skills : {};
  const enabled = Array.isArray(skills.enabled) ? skills.enabled : [];
  if (!enabled.includes('memory')) {
    config.skills = { ...skills, enabled: [...enabled, 'memory'] };
  }
  // Ensure WhatsApp is enabled so --test uses the mock socket (not telegram-only path where sock is null).
  const channels = config.channels && typeof config.channels === 'object' ? config.channels : {};
  const whatsapp = channels.whatsapp && typeof channels.whatsapp === 'object' ? channels.whatsapp : {};
  if (!whatsapp.enabled) {
    config.channels = { ...channels, whatsapp: { ...whatsapp, enabled: true } };
  }
  writeFileSync(join(stateDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');

  if (existsSync(join(DEFAULT_STATE_DIR, '.env'))) {
    copyFileSync(join(DEFAULT_STATE_DIR, '.env'), join(stateDir, '.env'));
  }
  return { stateDir, workspaceDir };
}

/**
 * Run the main app in --test mode with one message; return the reply text.
 * @param {string} userMessage
 * @param {{ stateDir?: string }} [opts]
 * @returns {Promise<string>}
 */
function runE2E(userMessage, opts = {}) {
  const env = { ...process.env };
  if (opts.stateDir) env.COWCODE_STATE_DIR = opts.stateDir;
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(INSTALL_ROOT, 'index.js'), '--test', userMessage], {
      cwd: INSTALL_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`E2E run timed out after ${PER_TEST_TIMEOUT_MS / 1000}s`));
    }, PER_TEST_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      const startIdx = stdout.indexOf(E2E_REPLY_MARKER_START);
      const endIdx = stdout.indexOf(E2E_REPLY_MARKER_END);
      if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
        reject(new Error(`No E2E reply in output (code ${code}). stderr: ${stderr.slice(-500)}`));
        return;
      }
      const reply = stdout
        .slice(startIdx + E2E_REPLY_MARKER_START.length, endIdx)
        .replace(/^\n+|\n+$/g, '')
        .trim();
      if (code !== 0) {
        reject(new Error(`Process exited ${code}. Reply: ${reply.slice(0, 200)}`));
        return;
      }
      resolve(reply);
    });
  });
}

/**
 * Find the most recent chat-log file (by date) and return its path and lines.
 * @param {string} workspaceDir
 * @returns {{ path: string, lines: string[] } | null}
 */
function getLatestChatLog(workspaceDir) {
  const chatLogDir = join(workspaceDir, 'chat-log');
  if (!existsSync(chatLogDir)) return null;
  const names = readdirSync(chatLogDir).filter((n) => n.endsWith('.jsonl'));
  if (names.length === 0) return null;
  names.sort();
  const path = join(chatLogDir, names[names.length - 1]);
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim());
  return { path, lines };
}

/** Detect if failure is due to missing LLM config (no config, no models, no API key, etc.). */
function isNoLlmError(err) {
  const msg = (err && err.message) || '';
  return (
    /API key not set|not set|ERR_INVALID_URL|ECONNREFUSED/.test(msg) ||
    /No config at|has no llm\.models/.test(msg)
  );
}

async function main() {
  console.log('E2E memory tests: chat log written + memory recall (needs embedding for recall).');
  console.log('Timeout per test:', PER_TEST_TIMEOUT_MS / 1000, 's.');
  if (INSTALL_ROOT !== ROOT) console.log('Using system install (COWCODE_INSTALL_DIR):', INSTALL_ROOT);
  console.log('');

  const storeMessage = `Memory e2e test message at ${Date.now()}.`;
  const storePhraseMessage = `Remember this exact phrase for the next message: ${MEMORY_RECALL_PHRASE}.`;
  const recallQuery = `What was the exact phrase I asked you to remember in the previous message? Reply with only that phrase.`;

  const tests = [
    {
      name: 'memory: chat log written',
      run: async () => {
        const { stateDir, workspaceDir } = createTempStateDir();
        const reply = await runE2E(storeMessage, { stateDir });
        assert(reply && reply.length > 0, 'Expected non-empty reply');
        const log = getLatestChatLog(workspaceDir);
        assert(log && log.lines.length >= 1, 'Expected at least one line in chat-log');
        const lastLine = log.lines[log.lines.length - 1];
        let parsed;
        try {
          parsed = JSON.parse(lastLine);
        } catch (_) {
          throw new Error('Chat log last line is not valid JSON');
        }
        assert(parsed.user === storeMessage, `Expected last exchange user to match. Got user: ${(parsed.user || '').slice(0, 80)}`);
        assert(parsed.assistant && parsed.assistant.length > 0, 'Expected non-empty assistant reply in chat log');
      },
    },
    {
      name: 'memory: recall (store phrase → ask for it)',
      run: async () => {
        const { stateDir } = createTempStateDir();
        const reply1 = await runE2E(storePhraseMessage, { stateDir });
        assert(reply1 && reply1.length > 0, 'Expected non-empty first reply');
        const reply2 = await runE2E(recallQuery, { stateDir });
        assert(
          reply2 && reply2.includes(MEMORY_RECALL_PHRASE),
          `Expected reply to contain "${MEMORY_RECALL_PHRASE}". Got (first 300 chars): ${(reply2 || '').slice(0, 300)}. If embedding is not configured, set memory.embedding or use an LLM provider with embeddings.`
        );
      },
    },
  ];

  const { failed } = await runSkillTests('memory', tests);
  if (failed > 0) {
    console.log('\nMemory E2E: set LLM + embedding API key in .env for full recall test.');
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
