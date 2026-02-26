/**
 * Me skill: build a profile of what we know about the user from MEMORY.md, memory/*.md, and recent chat logs.
 * Presents it in a human-friendly format.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const CHAT_LOG_DIR = 'chat-log';
const PRIVATE_CHAT_DIR = 'private';
const DATE_FILE_RE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
const MAX_DAYS_CHAT = 7;
const MAX_EXCHANGES_SUMMARY = 30;

function getChatLogDir(workspaceDir) {
  return join(workspaceDir, CHAT_LOG_DIR);
}

function safeJidForFile(jid) {
  if (jid == null || String(jid).trim() === '') return 'unknown';
  return String(jid).trim().replace(/[^0-9a-zA-Z._-]/g, '_') || 'unknown';
}

function readNotes(workspaceDir) {
  const out = { memoryMd: '', memoryFiles: [] };
  const memoryPath = join(workspaceDir, 'MEMORY.md');
  if (existsSync(memoryPath)) {
    try {
      out.memoryMd = readFileSync(memoryPath, 'utf8').trim();
    } catch (_) {}
  }
  const memoryDir = join(workspaceDir, 'memory');
  if (existsSync(memoryDir)) {
    try {
      const names = readdirSync(memoryDir, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith('.md'))
        .map((f) => f.name)
        .sort();
      for (const name of names) {
        const full = join(memoryDir, name);
        try {
          const content = readFileSync(full, 'utf8').trim();
          out.memoryFiles.push({ name: `memory/${name}`, content });
        } catch (_) {}
      }
    } catch (_) {}
  }
  return out;
}

function readDateBasedChatLogs(workspaceDir, maxDays = MAX_DAYS_CHAT) {
  const dir = getChatLogDir(workspaceDir);
  if (!existsSync(dir)) return [];
  let files = [];
  try {
    files = readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && DATE_FILE_RE.test(f.name))
      .map((f) => f.name)
      .sort()
      .reverse()
      .slice(0, maxDays);
  } catch (_) {
    return [];
  }
  const all = [];
  for (const name of files) {
    const path = join(dir, name);
    try {
      const content = readFileSync(path, 'utf8');
      for (const line of content.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const row = JSON.parse(t);
          if (row != null && (row.user != null || row.assistant != null)) {
            all.push({
              date: name.replace('.jsonl', ''),
              ts: row.ts || 0,
              user: String(row.user ?? '').trim(),
              assistant: String(row.assistant ?? '').trim(),
            });
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  all.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return all;
}

function readPrivateChatLog(workspaceDir, jid) {
  if (!jid || String(jid).trim() === '') return [];
  const file = join(getChatLogDir(workspaceDir), PRIVATE_CHAT_DIR, safeJidForFile(jid) + '.jsonl');
  if (!existsSync(file)) return [];
  const out = [];
  try {
    const content = readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const row = JSON.parse(t);
        if (row != null && (row.user != null || row.assistant != null)) {
          out.push({
            ts: row.ts || 0,
            user: String(row.user ?? '').trim(),
            assistant: String(row.assistant ?? '').trim(),
          });
        }
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}

function formatProfile(notes, dateBasedExchanges, privateExchanges) {
  const sections = [];

  if (notes.memoryMd || notes.memoryFiles.length > 0) {
    const parts = [];
    if (notes.memoryMd) {
      const preview = notes.memoryMd.slice(0, 3000);
      if (notes.memoryMd.length > 3000) parts.push(preview + '\n… (truncated)');
      else parts.push(preview);
    }
    for (const f of notes.memoryFiles) {
      const preview = f.content.slice(0, 1500);
      const truncated = f.content.length > 1500;
      parts.push(`[${f.name}]\n${preview}${truncated ? '\n… (truncated)' : ''}`);
    }
    sections.push('From your notes (MEMORY.md and memory/*.md):\n' + parts.join('\n\n'));
  } else {
    sections.push('From your notes: Nothing stored yet in MEMORY.md or memory/*.md.');
  }

  const allChat = [...privateExchanges];
  const dateSet = new Set();
  for (const ex of dateBasedExchanges) {
    if (!dateSet.has(ex.date)) dateSet.add(ex.date);
    allChat.push(ex);
  }
  allChat.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const recent = allChat.slice(-MAX_EXCHANGES_SUMMARY);

  if (recent.length > 0) {
    const byDate = {};
    for (const ex of recent) {
      const d = ex.date || (ex.ts ? new Date(ex.ts).toISOString().slice(0, 10) : '');
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push({ user: ex.user, assistant: ex.assistant });
    }
    const dateKeys = Object.keys(byDate).sort();
    const lines = [];
    for (const d of dateKeys) {
      const exchanges = byDate[d];
      lines.push(`**${d}** (${exchanges.length} exchange${exchanges.length !== 1 ? 's' : ''})`);
      for (const ex of exchanges.slice(-5)) {
        if (ex.user) lines.push('  You: ' + ex.user.slice(0, 120) + (ex.user.length > 120 ? '…' : ''));
        if (ex.assistant) lines.push('  Me: ' + ex.assistant.slice(0, 120) + (ex.assistant.length > 120 ? '…' : ''));
      }
      if (exchanges.length > 5) lines.push('  … and ' + (exchanges.length - 5) + ' more');
    }
    sections.push('From recent conversations (last ' + MAX_DAYS_CHAT + ' days):\n' + lines.join('\n'));
  } else {
    sections.push('From recent conversations: No chat logs found for the last few days.');
  }

  return (
    "Here's what I know about you:\n\n" +
    sections.join('\n\n---\n\n') +
    "\n\n(I only know what's in your notes and our recent chats. You can add more in MEMORY.md or memory/*.md, or tell me things and I'll remember them in context.)"
  );
}

/**
 * @param {object} ctx - { workspaceDir, jid }
 * @param {object} args - No required args
 */
export async function executeMe(ctx, args) {
  const workspaceDir = ctx?.workspaceDir || '';
  if (!workspaceDir) {
    return JSON.stringify({ error: 'Workspace path not available.' });
  }

  const jid = ctx?.jid;

  const notes = readNotes(workspaceDir);
  const dateBasedExchanges = readDateBasedChatLogs(workspaceDir);
  const privateExchanges = readPrivateChatLog(workspaceDir, jid);

  const profile = formatProfile(notes, dateBasedExchanges, privateExchanges);
  return profile;
}
