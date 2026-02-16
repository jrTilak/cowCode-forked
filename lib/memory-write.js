/**
 * Append a line to workspace/memory/<today>.md. Keeps history short; memory grows by day.
 * Used after cron add so the LLM can see "Yesterday you said a reminder" without stuffing it in the prompt.
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * @param {string} workspaceDir - e.g. getWorkspaceDir()
 * @param {string} text - Line to append (e.g. "Added reminder: call Bishwas at 2/17/2026, 5:30:00 PM")
 */
export function memoryWrite(workspaceDir, text) {
  if (!workspaceDir || typeof workspaceDir !== 'string') return;
  const now = new Date();
  const date = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const dir = join(workspaceDir, 'memory');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, date + '.md');
  const line = (text || '').trim();
  if (line) appendFileSync(file, line + '\n', 'utf8');
}
