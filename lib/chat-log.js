/**
 * Chat log: append each user/assistant exchange to workspace/chat-log/YYYY-MM-DD.jsonl.
 * Used so memory search can pull from conversation history ("Remember what we said yesterday?").
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const CHAT_LOG_DIR = 'chat-log';

/**
 * @param {string} workspaceDir
 * @returns {string} Absolute path to chat-log dir
 */
function getChatLogDir(workspaceDir) {
  return join(workspaceDir, CHAT_LOG_DIR);
}

/**
 * Append one exchange to chat-log/YYYY-MM-DD.jsonl. Creates dir/file if needed.
 * @param {string} workspaceDir
 * @param {{ user: string, assistant: string, timestampMs: number, jid?: string }} exchange
 * @returns {{ path: string, lineNumber: number }} Relative path (e.g. chat-log/2025-02-16.jsonl) and 1-based line number of this exchange
 */
export function appendExchange(workspaceDir, exchange) {
  if (!workspaceDir || typeof workspaceDir !== 'string') {
    throw new Error('workspaceDir is required');
  }
  const { user, assistant, timestampMs, jid } = exchange;
  const date = new Date(timestampMs);
  const dateStr =
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0');
  const dir = getChatLogDir(workspaceDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, dateStr + '.jsonl');
  const line = JSON.stringify({
    ts: timestampMs,
    jid: jid ?? null,
    user: String(user ?? '').trim(),
    assistant: String(assistant ?? '').trim(),
  }) + '\n';
  appendFileSync(filePath, line, 'utf8');
  const content = readFileSync(filePath, 'utf8');
  const lineNumber = content.split('\n').filter((l) => l.trim()).length;
  const relPath = CHAT_LOG_DIR + '/' + dateStr + '.jsonl';
  return { path: relPath, lineNumber };
}
