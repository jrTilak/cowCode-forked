/**
 * Shared E2E judge: a separate LLM call to decide whether the user got what they wanted.
 * See E2E.md for the testing model (we test the project's skill, not APIs/tokens).
 *
 * Usage:
 *   const { judgeUserGotWhatTheyWanted } = await import('./e2e-judge.js');
 *   const { pass, reason } = await judgeUserGotWhatTheyWanted(userMessage, botReply, stateDir, { prompt: customPrompt });
 *   or use default prompt with skillHint: 'cron' | 'browser' | 'memory' | 'home-assistant' | 'write' | 'edit' | 'me'
 */

import dotenv from 'dotenv';
import { getEnvPath } from '../../lib/paths.js';

/**
 * @param {string} userMessage - What the user asked.
 * @param {string} botReply - The reply the bot produced.
 * @param {string} stateDir - State dir for config/env (LLM API key etc.).
 * @param {{ prompt?: string, skillHint?: string }} [opts] - If prompt is set, use it. Else use skillHint to build a default prompt.
 * @returns {Promise<{ pass: boolean, reason?: string }>}
 */
export async function judgeUserGotWhatTheyWanted(userMessage, botReply, stateDir, opts = {}) {
  const prevStateDir = process.env.COWCODE_STATE_DIR;
  process.env.COWCODE_STATE_DIR = stateDir;
  try {
    dotenv.config({ path: getEnvPath() });
    const { chat } = await import('../../llm.js');
    const prompt =
      opts.prompt ||
      buildDefaultJudgePrompt(userMessage, botReply, opts.skillHint || 'skill');
    const response = await chat([{ role: 'user', content: prompt }]);
    const trimmed = (response || '').trim().toUpperCase();
    const pass = trimmed.startsWith('YES');
    return { pass, reason: (response || '').trim().slice(0, 600) };
  } finally {
    if (prevStateDir !== undefined) process.env.COWCODE_STATE_DIR = prevStateDir;
    else delete process.env.COWCODE_STATE_DIR;
  }
}

/**
 * @param {string} userMessage
 * @param {string} botReply
 * @param {string} skillHint - 'cron' | 'browser' | 'memory' | 'write' | 'edit' | 'me' | 'skill'
 */
function buildDefaultJudgePrompt(userMessage, botReply, skillHint) {
  const criteria = {
    cron:
      'The reply must deliver the actual outcome of the cron skill. For listing: show a real list of reminders or explicitly say there are no reminders. For adding: confirm the reminder was scheduled (time/description). For removing: confirm removal or explain what was removed. A reply that only explains reminders or offers to help without showing the outcome is NO. Reply should be in the same language as the user.',
    browser:
      'The reply must deliver the requested content. For news/headlines: must contain headlines, a summary, or current news. For search/navigate: must contain relevant content from the search or page. For non-news queries: must answer with real content, not only a generic news block. A reply that says it cannot do it, or gives only setup/error text without the requested data, is NO.',
    memory:
      'The reply must show that memory was used. If the user asked to recall something: the reply must reference or state what was stored. If the bot says it does not know, does not have that information, or could not find it, answer NO. A reply that only explains memory without returning recalled content is NO.',
    write:
      'The reply must confirm the file was written, created, or saved (e.g. path, filename, or clear success). A reply that refuses to write, only explains how to write, or errors without confirming the write happened is NO. Vague or unhelpful output is NO.',
    edit:
      'The reply must confirm the edit was applied (e.g. replaced, updated, changed in file X). A reply that refuses to edit, only explains editing, or errors without confirming the edit happened is NO. Vague or unhelpful output is NO.',
    me:
      'The reply must contain actual substantive information about the user (e.g. from MEMORY.md or profile: name, preferences, projects, things learned). A reply that only says there are no details saved, nothing learned, no profile yet, or "I don\'t have any personal details about you" is NOT what the user wanted — answer NO. Pass (YES) only if the reply includes real profile or memory content about the user. An error or refusing to use the me skill is NO.',
    'home-assistant':
      'The reply must show that Home Assistant was queried and return real data. For "list my lights" or "what lights": must contain a list of light entities or a clear "no lights" after a successful query. For "list devices": must show entities, count, or examples from the API. A reply that only says it cannot reach HA, or gives setup/error without listing any entities, is NO.',
    skill:
      'The reply must deliver what the user asked for: real data (e.g. list, result), a clear outcome, or an explicit "no items" / "nothing found" where that is the correct answer. Polite non-answers, setup instructions alone, or vague text that does not fulfill the request are NO. Error messages are not "what they wanted" unless the user asked for help.',
  };
  const hint = criteria[skillHint] || criteria.skill;
  return `You are a test judge. The user asked:

"${userMessage}"

The bot replied:

---
${botReply}
---

Did the user GET WHAT THEY WANTED? ${hint}

Answer with exactly one line: YES or NO. Then add one short sentence explaining why.`;
}
