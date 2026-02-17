#!/usr/bin/env node
/**
 * One-command setup: install deps, one-time onboarding (base URL, optional API keys), then run the app.
 * On first run the app will show QR to link WhatsApp, then start the bot.
 * Usage: npm run setup | pnpm run setup | yarn setup | node setup.js
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { spawnSync, spawn } from 'child_process';
import { getConfigPath, getEnvPath, getAuthDir, getCronStorePath, ensureStateDir } from './lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const ENV_EXAMPLE = join(ROOT, '.env.example');

const C = { reset: '\x1b[0m', cyan: '\x1b[36m', dim: '\x1b[2m', green: '\x1b[32m', bold: '\x1b[1m' };
/** Color the main question label so all prompts look consistent. */
function q(label) {
  return C.cyan + label + C.reset;
}
function section(title) {
  console.log('');
  console.log(C.dim + '  ─────────────────────────────────────────' + C.reset);
  console.log(C.dim + '  ' + title + C.reset);
  console.log(C.dim + '  ─────────────────────────────────────────' + C.reset);
  console.log('');
}
function welcome() {
  console.log('');
  console.log(C.green + '  Welcome to cowCode' + C.reset);
  console.log(C.dim + '  WhatsApp + Telegram bot powered by your own LLM (local or cloud)' + C.reset);
  console.log('');
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

function checkQuit(answer) {
  if (answer && answer.toLowerCase() === 'q') {
    console.log('Quit.');
    process.exit(0);
  }
}

/** Prompt with full default value shown (e.g. for base URL). Press q to quit. */
async function promptWithDefault(prompt, defaultVal) {
  const def = defaultVal ? ` [${defaultVal}]` : '';
  const answer = await ask(`${prompt}${def} (q to quit): `);
  checkQuit(answer);
  return answer || defaultVal || '';
}

/** Select one of the model choices; returns the value (API model id). */
async function selectModel(message, choices) {
  if (!Array.isArray(choices) || choices.length === 0) return '';
  try {
    const select = (await import('@inquirer/select')).default;
    return await select({ message, choices });
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.message?.includes('@inquirer/select')) {
      const line = choices.map((c, i) => `${i + 1}. ${c.name}`).join('\n  ');
      const answer = await ask(`${message}\n  ${line}\n  Number or name (q to quit): `);
      checkQuit(answer);
      const n = parseInt(answer, 10);
      if (n >= 1 && n <= choices.length) return choices[n - 1].value;
      const byName = choices.find((c) => c.name.toLowerCase().includes((answer || '').toLowerCase()));
      return byName ? byName.value : choices[0].value;
    }
    throw err;
  }
}

/** Mask a secret for display: e.g. "sk-proj-Qx4ue..." -> "sk-proj-Qx***" */
function maskSecret(val) {
  if (!val || typeof val !== 'string') return '';
  const s = val.trim();
  if (s.length <= 8) return '***';
  return s.slice(0, 12) + '***';
}

/** Prompt for a secret; if already set, show masked hint. Press q to quit. */
async function promptSecret(prompt, existingVal) {
  const display = existingVal ? maskSecret(existingVal) : '';
  const def = display ? ` [${display}]` : '';
  const answer = await ask(`${prompt}${def} (q to quit): `);
  checkQuit(answer);
  return answer || existingVal || '';
}

/**
 * Cloud LLM provider → list of model choices for setup.
 * Value is the API model id. First option per provider is the recommended/latest.
 */
const CLOUD_LLM_MODELS = {
  openai: [
    { name: 'GPT-4o (recommended)', value: 'gpt-4o' },
    { name: 'GPT-4o mini', value: 'gpt-4o-mini' },
    { name: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
    { name: 'GPT-4', value: 'gpt-4' },
  ],
  grok: [
    { name: 'Grok 2 (recommended)', value: 'grok-2' },
    { name: 'Grok 2 mini', value: 'grok-2-mini' },
  ],
  anthropic: [
    { name: 'Claude 3.5 Sonnet (recommended)', value: 'claude-3-5-sonnet-20241022' },
    { name: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' },
    { name: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
  ],
};

/** Vision fallback: used only when the agent model is text-only (e.g. Llama, GPT-3.5). Same keys as main LLM. */
const VISION_FALLBACK_CHOICES = [
  { name: 'Skip (use only if your main model supports vision)', value: 'skip' },
  { name: 'OpenAI GPT-4o (vision)', value: 'openai' },
  { name: 'Anthropic Claude (vision)', value: 'anthropic' },
];

/** Returns first available package manager: pnpm, npm, or yarn. */
function getPackageManager() {
  for (const cmd of ['pnpm', 'npm', 'yarn']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout && String(r.stdout).trim().length > 0) return cmd;
  }
  return 'npm';
}

function migrateFromRoot() {
  ensureStateDir();
  const stateConfig = getConfigPath();
  const stateEnv = getEnvPath();
  const stateAuth = getAuthDir();
  const stateCron = getCronStorePath();
  const rootConfig = join(ROOT, 'config.json');
  const rootEnv = join(ROOT, '.env');
  const rootAuth = join(ROOT, 'auth_info');
  const rootCron = join(ROOT, 'cron', 'jobs.json');
  if (existsSync(rootConfig) && !existsSync(stateConfig)) {
    copyFileSync(rootConfig, stateConfig);
    console.log(C.dim + '  ✓ Migrated config.json to ~/.cowcode' + C.reset);
  }
  if (existsSync(rootEnv) && !existsSync(stateEnv)) {
    copyFileSync(rootEnv, stateEnv);
    console.log(C.dim + '  ✓ Migrated .env to ~/.cowcode' + C.reset);
  }
  if (existsSync(rootAuth)) {
    const creds = join(rootAuth, 'creds.json');
    if (existsSync(creds) && !existsSync(join(stateAuth, 'creds.json'))) {
      cpSync(rootAuth, stateAuth, { recursive: true });
      console.log(C.dim + '  ✓ Migrated auth_info to ~/.cowcode' + C.reset);
    }
  }
  if (existsSync(rootCron) && !existsSync(stateCron)) {
    mkdirSync(dirname(stateCron), { recursive: true });
    copyFileSync(rootCron, stateCron);
    console.log(C.dim + '  ✓ Migrated cron/jobs.json to ~/.cowcode' + C.reset);
  }
}

function ensureInstall() {
  const nodeModules = join(ROOT, 'node_modules');
  if (!existsSync(nodeModules) || !existsSync(join(nodeModules, '@whiskeysockets', 'baileys'))) {
    const pm = getPackageManager();
    section('Installing dependencies');
    console.log('  Running: ' + pm + ' install');
    console.log('');
    const res = spawnSync(pm, ['install'], { cwd: ROOT, stdio: 'inherit' });
    if (res.status !== 0) {
      console.error('  ' + pm + ' install failed.');
      process.exit(res.status ?? 1);
    }
    console.log('');
    console.log(C.dim + '  ✓ Dependencies ready.' + C.reset);
  }
}

function loadConfig() {
  if (!existsSync(getConfigPath())) return null;
  try {
    return JSON.parse(readFileSync(getConfigPath(), 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
}

/** Detect host timezone (IANA) and 12/24 format; set in config so install sets them, not "auto". */
function ensureAgentsDefaultsFromHost() {
  const config = loadConfig();
  if (!config) return;
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  const def = config.agents.defaults;
  const tz = def.userTimezone != null ? String(def.userTimezone).trim() : '';
  const fmt = def.timeFormat != null ? String(def.timeFormat).trim().toLowerCase() : '';
  let changed = false;
  if (!tz || tz.toLowerCase() === 'auto') {
    try {
      config.agents.defaults.userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      changed = true;
    } catch {
      config.agents.defaults.userTimezone = 'UTC';
      changed = true;
    }
  }
  if (!fmt || fmt === 'auto') {
    try {
      const opts = Intl.DateTimeFormat().resolvedOptions();
      const hour12 = opts.hour12;
      if (hour12 === true) config.agents.defaults.timeFormat = '12';
      else if (hour12 === false) config.agents.defaults.timeFormat = '24';
      else {
        const sample = new Intl.DateTimeFormat(opts.locale, { hour: 'numeric' }).formatToParts(new Date());
        config.agents.defaults.timeFormat = sample.some((p) => p.type === 'dayPeriod') ? '12' : '24';
      }
      changed = true;
    } catch {
      config.agents.defaults.timeFormat = '12';
      changed = true;
    }
  }
  if (changed) saveConfig(config);
}

function getDefaultBaseUrl(config) {
  const first = config?.llm?.models?.[0];
  if (first?.baseUrl) return first.baseUrl;
  return 'http://127.0.0.1:1234/v1';
}

function parseEnv(content) {
  const lines = (content || '').split('\n');
  const out = {};
  for (const line of lines) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (key && !key.startsWith('#')) out[key] = val;
  }
  return out;
}

function stringifyEnv(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function ensureConfig() {
  let config = loadConfig();
  if (!config) {
    const rootConfig = join(ROOT, 'config.json');
    if (existsSync(rootConfig)) {
      try {
        config = JSON.parse(readFileSync(rootConfig, 'utf8'));
        ensureStateDir();
        saveConfig(config);
      } catch {
        config = {};
      }
    }
    if (!config || !config.llm) {
      config = config || {};
      config.llm = config.llm || {
        maxTokens: 2048,
        models: [
          { provider: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local', apiKey: 'not-needed' },
          { provider: 'openai', apiKey: 'LLM_1_API_KEY' },
          { provider: 'grok', apiKey: 'LLM_2_API_KEY' },
          { provider: 'anthropic', apiKey: 'LLM_3_API_KEY' },
        ],
      };
      ensureStateDir();
      saveConfig(config);
    }
  }
  return config;
}

async function onboarding() {
  let config = ensureConfig();
  const defaultBaseUrl = getDefaultBaseUrl(config);
  const envPath = getEnvPath();
  const hasEnv = existsSync(envPath);
  const envContent = hasEnv ? readFileSync(envPath, 'utf8') : '';
  const env = parseEnv(envContent);

  section('Configuration (optional — press Enter to keep defaults or skip)');

  const baseUrl = await promptWithDefault(q('Local LLM base URL (e.g. LM Studio)'), defaultBaseUrl || '');

  // Cloud LLM: ask provider directly, with skip
  let llm1Key = env.LLM_1_API_KEY || '';
  let llm2Key = env.LLM_2_API_KEY || '';
  let llm3Key = env.LLM_3_API_KEY || '';

  let provider;
  try {
    const select = (await import('@inquirer/select')).default;
    provider = await select({
      message: q('Cloud LLM provider?'),
      choices: [
        { name: 'Skip', value: 'skip' },
        { name: 'OpenAI', value: 'openai' },
        { name: 'Grok', value: 'grok' },
        { name: 'Anthropic', value: 'anthropic' },
        { name: 'Quit', value: 'quit' },
      ],
    });
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.message?.includes('@inquirer/select')) {
      const answer = await ask(q('Cloud LLM provider?') + ' (skip / openai / grok / anthropic, q to quit): ');
      checkQuit(answer);
      provider = (answer || '').trim().toLowerCase() || 'skip';
    } else {
      throw err;
    }
  }
  if (provider === 'quit') {
    console.log('Quit.');
    process.exit(0);
  }
  let selectedModel = '';
  if (provider === 'openai') {
    llm1Key = await promptSecret(q('OpenAI API key'), env.LLM_1_API_KEY || '');
    const models = CLOUD_LLM_MODELS.openai;
    selectedModel = await selectModel(q('OpenAI model version'), models);
  } else if (provider === 'grok') {
    llm2Key = await promptSecret(q('Grok API key'), env.LLM_2_API_KEY || '');
    const models = CLOUD_LLM_MODELS.grok;
    selectedModel = await selectModel(q('Grok model version'), models);
  } else if (provider === 'anthropic') {
    llm3Key = await promptSecret(q('Anthropic API key'), env.LLM_3_API_KEY || '');
    const models = CLOUD_LLM_MODELS.anthropic;
    selectedModel = await selectModel(q('Anthropic (Claude) model version'), models);
  }

  const braveKey = await promptSecret(q('Brave Search API key – optional'), env.BRAVE_API_KEY || '');

  // Vision fallback: for image reading when the main agent model is text-only. Set at setup; no mid-run prompts.
  let visionFallbackProvider = 'skip';
  try {
    const select = (await import('@inquirer/select')).default;
    visionFallbackProvider = await select({
      message: q('Vision fallback for image reading? (when your main model is text-only)'),
      choices: VISION_FALLBACK_CHOICES,
    });
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.message?.includes('@inquirer/select')) {
      const answer = await ask(q('Vision fallback?') + ' (skip / openai / anthropic, q to quit): ');
      checkQuit(answer);
      visionFallbackProvider = (answer || '').trim().toLowerCase() || 'skip';
    } else {
      throw err;
    }
  }
  if (visionFallbackProvider === 'openai' || visionFallbackProvider === 'anthropic') {
    config = loadConfig() || config;
    if (!config.skills) config.skills = {};
    if (!config.skills.vision) config.skills.vision = {};
    const visionModel = visionFallbackProvider === 'openai'
      ? await selectModel(q('OpenAI vision model'), CLOUD_LLM_MODELS.openai)
      : await selectModel(q('Anthropic vision model'), CLOUD_LLM_MODELS.anthropic);
    config.skills.vision.fallback = {
      provider: visionFallbackProvider,
      model: visionModel || (visionFallbackProvider === 'openai' ? 'gpt-4o' : 'claude-3-5-sonnet-20241022'),
      apiKey: visionFallbackProvider === 'openai' ? 'LLM_1_API_KEY' : 'LLM_3_API_KEY',
    };
    saveConfig(config);
  }

  if (baseUrl && config?.llm?.models?.[0]) {
    config.llm.models[0].baseUrl = baseUrl;
    saveConfig(config);
  }

  const newEnv = { ...env };
  newEnv.LLM_1_API_KEY = llm1Key ?? '';
  newEnv.LLM_2_API_KEY = llm2Key ?? '';
  newEnv.LLM_3_API_KEY = llm3Key ?? '';
  newEnv.BRAVE_API_KEY = braveKey ?? '';

  writeFileSync(getEnvPath(), stringifyEnv(newEnv), 'utf8');

  // When user adds a cloud LLM key during setup, set that model as priority and chosen version.
  const cloudKeyAdded = provider !== 'skip' && (
    (provider === 'openai' && (llm1Key ?? '').trim()) ||
    (provider === 'grok' && (llm2Key ?? '').trim()) ||
    (provider === 'anthropic' && (llm3Key ?? '').trim())
  );
  if (cloudKeyAdded && Array.isArray(config?.llm?.models)) {
    const models = config.llm.models;
    const hasPriorityAlready = models.some(
      (m) => m.priority === true || m.priority === 1 || String(m.priority).toLowerCase() === 'true'
    );
    if (!hasPriorityAlready) {
      for (let i = 0; i < models.length; i++) {
        const p = (models[i].provider || '').toLowerCase();
        const isChosen = p === provider;
        models[i].priority = isChosen;
        if (isChosen && selectedModel) models[i].model = selectedModel;
      }
      saveConfig(config);
    } else if (selectedModel) {
      // Re-run setup: still update the chosen provider's model version.
      for (let i = 0; i < models.length; i++) {
        if ((models[i].provider || '').toLowerCase() === provider) {
          models[i].model = selectedModel;
          saveConfig(config);
          break;
        }
      }
    }
  }

  console.log('');
  console.log(C.dim + '  ✓ Config and .env saved to ~/.cowcode' + C.reset);
}

async function main() {
  if (!process.stdin.isTTY) {
    console.log('Setup needs an interactive terminal.');
    console.log('Run: cd cowCode && node setup.js');
    console.log('Or: cd cowCode && npm install && npm start\n');
    process.exit(0);
  }
  welcome();
  migrateFromRoot();
  ensureInstall();
  ensureAgentsDefaultsFromHost();

  await onboarding();

  section('Messaging');
  let messagingFirst = 'whatsapp';
  let telegramOnly = false;
  try {
    const select = (await import('@inquirer/select')).default;
    const choice = await select({
      message: q('Which do you want to set up first?'),
      choices: [
        { name: 'WhatsApp (link your phone)', value: 'whatsapp' },
        { name: 'Telegram (bot token from @BotFather)', value: 'telegram' },
      ],
    });
    messagingFirst = choice;
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.message?.includes('@inquirer/select')) {
      const answer = await ask(q('Which first?') + ' (1=WhatsApp 2=Telegram, q to quit): ');
      checkQuit(answer);
      messagingFirst = (answer || '1').trim() === '2' ? 'telegram' : 'whatsapp';
    } else {
      throw err;
    }
  }

  const envPath = getEnvPath();
  const hasEnv = existsSync(envPath);
  const envContent = hasEnv ? readFileSync(envPath, 'utf8') : '';
  let env = parseEnv(envContent);

  if (messagingFirst === 'telegram') {
    const telegramToken = await promptSecret(q('Telegram bot token (from @BotFather)'), env.TELEGRAM_BOT_TOKEN || '');
    if (telegramToken) {
      env.TELEGRAM_BOT_TOKEN = telegramToken;
      writeFileSync(envPath, stringifyEnv(env), 'utf8');
      console.log(C.dim + '  ✓ Telegram token saved.' + C.reset);
      const config = loadConfig() || {};
      config.channels = config.channels || {};
      config.channels.telegram = { enabled: true, botToken: 'TELEGRAM_BOT_TOKEN' };
      saveConfig(config);
    }
    const addWa = await ask(q('Add WhatsApp too? (y/n)') + ' ');
    if ((addWa || '').toLowerCase().startsWith('y')) {
      console.log('');
      console.log('  Linking WhatsApp — a QR code or pairing prompt will appear.');
      console.log('');
      const authResult = spawnSync(process.execPath, [join(ROOT, 'index.js'), '--auth-only'], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: false,
        env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' },
      });
      if (authResult.status !== 0) {
        console.log(C.dim + '  WhatsApp linking failed or skipped. You can run: cowcode auth' + C.reset);
      }
    } else {
      telegramOnly = true;
      const config = loadConfig() || {};
      config.channels = config.channels || {};
      config.channels.whatsapp = { enabled: false };
      if (!config.channels.telegram) config.channels.telegram = { enabled: true, botToken: 'TELEGRAM_BOT_TOKEN' };
      saveConfig(config);
    }
  } else {
    const addTg = await ask(q('Add Telegram too? (y/n)') + ' ');
    if ((addTg || '').toLowerCase().startsWith('y')) {
      const telegramToken = await promptSecret(q('Telegram bot token (from @BotFather)'), env.TELEGRAM_BOT_TOKEN || '');
      if (telegramToken) {
        env.TELEGRAM_BOT_TOKEN = telegramToken;
        writeFileSync(envPath, stringifyEnv(env), 'utf8');
        console.log(C.dim + '  ✓ Telegram token saved.' + C.reset);
        const config = loadConfig() || {};
        config.channels = config.channels || {};
        config.channels.telegram = { enabled: true, botToken: 'TELEGRAM_BOT_TOKEN' };
        saveConfig(config);
      }
    }
  }

  section('Starting cowCode');
  if (telegramOnly) {
    console.log('  Running in Telegram-only mode. Message your bot on Telegram to chat.');
    console.log('  To add WhatsApp later: cowcode auth  then  cowcode moo start');
  } else {
    console.log('  If this is your first time with WhatsApp, you\'ll see a QR code — scan it.');
    console.log('  Then send a message to your own number to start chatting.');
    if (env.TELEGRAM_BOT_TOKEN) {
      console.log('  Telegram is also enabled — you can message your bot there.');
    }
  }
  console.log('');
  const child = spawn('node', ['index.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'development',
      ...(telegramOnly ? { COWCODE_TELEGRAM_ONLY: '1' } : {}),
    },
  });
  child.on('close', (code) => {
    console.log('');
    console.log('  ------------------------------------------------');
    console.log('  To start the bot:  cowcode moo start');
    console.log('  (or from this folder:  npm start)');
    console.log('');
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
