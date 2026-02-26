#!/usr/bin/env node
/**
 * One-off agent run for the dashboard chat UI.
 * Reads JSON from stdin: { "message": "...", "history": [ { "role": "user"|"assistant", "content": "..." } ] }
 * Writes one JSON line to stdout: { "textToSend": "..." } or { "error": "..." }
 * Uses same soul/identity and skills as main app (workspace SOUL.md, WhoAmI.md, MyHuman.md).
 */

import { getEnvPath, getConfigPath, getCronStorePath, getWorkspaceDir, getStateDir } from '../lib/paths.js';
import dotenv from 'dotenv';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { getSkillContext } from '../skills/loader.js';
import { runAgentTurn } from '../lib/agent.js';
import { getSchedulingTimeContext } from '../lib/timezone.js';

dotenv.config({ path: getEnvPath() });

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTALL_DIR = (process.env.COWCODE_INSTALL_DIR && resolve(process.env.COWCODE_INSTALL_DIR)) || ROOT;
const DEFAULT_WORKSPACE_DIR = join(INSTALL_DIR, 'workspace-default');

const SOUL_MD = 'SOUL.md';
const WHO_AM_I_MD = 'WhoAmI.md';
const MY_HUMAN_MD = 'MyHuman.md';
const WORKSPACE_DEFAULT_FILES = [WHO_AM_I_MD, MY_HUMAN_MD, SOUL_MD];

function readWorkspaceMd(filename) {
  const p = join(getWorkspaceDir(), filename);
  try {
    if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  } catch (_) {}
  return '';
}

function readDefaultSoul() {
  const p = join(DEFAULT_WORKSPACE_DIR, SOUL_MD);
  try {
    if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  } catch (_) {}
  return '';
}

function getBioFromConfig() {
  try {
    const raw = readFileSync(getConfigPath(), 'utf8');
    const full = JSON.parse(raw);
    return full.bio || null;
  } catch (_) {
    return null;
  }
}

function buildSystemPrompt() {
  const timeCtx = getSchedulingTimeContext();
  const timeBlock = `\n\n${timeCtx.timeContextLine}\nCurrent time UTC (for scheduling "at"): ${timeCtx.nowIso}. Examples: "in 1 minute" = ${timeCtx.in1min}; "in 2 minutes" = ${timeCtx.in2min}; "in 3 minutes" = ${timeCtx.in3min}.`;
  const workspaceDir = getWorkspaceDir();
  const pathsLine = `\n\nCowCode on this system: state dir ${getStateDir()}, workspace ${workspaceDir}. When the user asks where cowcode is installed or where config is, use the read skill with path \`~/.cowcode/config.json\` (or the state dir path above) to show config and confirm.`;
  let soulContent = (readWorkspaceMd(SOUL_MD) || readDefaultSoul()) + pathsLine;
  let whoAmIContent = readWorkspaceMd(WHO_AM_I_MD);
  const myHumanContent = readWorkspaceMd(MY_HUMAN_MD);
  if (!whoAmIContent && !myHumanContent) {
    const bio = getBioFromConfig();
    const bioText = typeof bio === 'string' && (bio || '').trim() ? bio.trim() : null;
    if (bioText) whoAmIContent = bioText;
  }
  let identityBlock = '';
  if (whoAmIContent || myHumanContent) {
    if (whoAmIContent) identityBlock += '\n\n' + whoAmIContent;
    if (myHumanContent) identityBlock += '\n\n' + myHumanContent;
  } else {
    const bio = getBioFromConfig();
    if (bio != null) {
      if (typeof bio === 'string' && bio.trim()) {
        identityBlock = '\n\n' + bio.trim();
      } else if (typeof bio === 'object' && (bio.userName || bio.assistantName || bio.whoAmI || bio.whoAreYou)) {
        const parts = [];
        if (bio.userName) parts.push(`The user's name is ${bio.userName}.`);
        if (bio.assistantName) parts.push(`Your name is ${bio.assistantName}.`);
        if (bio.whoAmI) parts.push(`The user describes themselves: ${bio.whoAmI}.`);
        if (bio.whoAreYou) parts.push(`You describe yourself: ${bio.whoAreYou}.`);
        if (parts.length) identityBlock = '\n\n' + parts.join(' ');
      }
    }
  }
  return soulContent + identityBlock + timeBlock;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const payload = JSON.parse(raw || '{}');
  const message = payload.message && String(payload.message).trim();
  if (!message) {
    process.stdout.write(JSON.stringify({ error: 'message is required' }) + '\n');
    process.exit(1);
  }
  const history = Array.isArray(payload.history) ? payload.history : [];
  const historyMessages = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: String(m.content) }));

  const workspaceDir = getWorkspaceDir();
  const noop = () => {};
  const ctx = {
    storePath: getCronStorePath(),
    jid: 'dashboard',
    workspaceDir,
    scheduleOneShot: noop,
    startCron: noop,
  };
  const skillContext = getSkillContext();
  const toolsToUse = Array.isArray(skillContext.runSkillTool) && skillContext.runSkillTool.length > 0 ? skillContext.runSkillTool : [];

  try {
    const { textToSend } = await runAgentTurn({
      userText: message,
      ctx,
      systemPrompt: buildSystemPrompt(),
      tools: toolsToUse,
      historyMessages,
      getFullSkillDoc: skillContext.getFullSkillDoc,
    });
    process.stdout.write(JSON.stringify({ textToSend: textToSend || '' }) + '\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: err.message || String(err) }) + '\n');
    process.exit(1);
  }
}

main();
