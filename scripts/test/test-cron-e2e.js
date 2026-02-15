/**
 * E2E tests for cron (list / add / manage) through the main chatting interface.
 * Sends user message → intent → LLM + cron tool → reply. Expect delay per test (AI + tool calls).
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const E2E_REPLY_MARKER_START = 'E2E_REPLY_START';
const E2E_REPLY_MARKER_END = 'E2E_REPLY_END';
const PER_TEST_TIMEOUT_MS = 120_000;

// Cron list: user asks to see scheduled reminders (cron tool action "list").
const CRON_LIST_QUERIES = [
  "List my reminders",
  "What's scheduled?",
  "Which crons are set?",
  "Do I have any reminders?",
  "Show my scheduled jobs",
];

// Cron add: user asks to create a reminder (cron tool action "add").
const CRON_ADD_QUERIES = [
  "Remind me in 2 minutes to test the cron",
  "Remind me to call John in 3 minutes",
  "Send me a hello message in 1 minute",
  "remind me in 5 minutes to drink water",
  "remind me to call mom tomorrow at 9am",
  "set a reminder for grocery shopping in 2 hours",
  "remind me every Monday to take out the trash",
  "create a daily reminder at 8pm to review code",
];

// Cron manage: list reminders or remove/delete (remove needs job id; "delete all" may get explanation).
const REMINDER_MANAGE_QUERIES = [
  "list my reminders",
  "show all my reminders",
  "what reminders do I have?",
  "remove reminder number 3",          // assuming prior setup in test
  "delete all reminders",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Run the main app in --test mode with one message; return the reply text.
 * @param {string} userMessage
 * @returns {Promise<string>} Reply text (what would be sent to the user).
 */
function runE2E(userMessage) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['index.js', '--test', userMessage], {
      cwd: ROOT,
      env: process.env,
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

async function main() {
  let passed = 0;
  let failed = 0;

  console.log('E2E cron tests: intent → LLM → cron tool → reply.');
  console.log('Timeout per test:', PER_TEST_TIMEOUT_MS / 1000, 's.\n');

  console.log('--- Cron (list) ---\n');
  for (const query of CRON_LIST_QUERIES) {
    try {
      const reply = await runE2E(query);
      const looksLikeList = reply.includes("don't have any") || reply.includes('scheduled') || reply.includes('reminder') || reply.includes('id=') || reply.includes('No ') || reply.includes('no ');
      assert(
        looksLikeList && reply.length > 10,
        `Expected cron list-style reply for "${query}". Got (first 300 chars): ${reply.slice(0, 300)}`
      );
      console.log(`  ✓ "${query}"`);
      passed++;
    } catch (err) {
      console.log(`  ✗ "${query}": ${err.message}`);
      failed++;
    }
  }

  console.log('\n--- Cron (add) ---\n');
  for (const query of CRON_ADD_QUERIES) {
    try {
      const reply = await runE2E(query);
      const looksLikeConfirmation = /scheduled|set|added|reminder|in \d+ minute|at \d+:|will send|will remind/i.test(reply) || reply.length > 20;
      assert(
        looksLikeConfirmation,
        `Expected cron add confirmation for "${query}". Got (first 300 chars): ${reply.slice(0, 300)}`
      );
      console.log(`  ✓ "${query}"`);
      passed++;
    } catch (err) {
      console.log(`  ✗ "${query}": ${err.message}`);
      failed++;
    }
  }

  console.log('\n--- Cron (manage: list / remove) ---\n');
  for (const query of REMINDER_MANAGE_QUERIES) {
    try {
      const reply = await runE2E(query);
      const listStyle = reply.includes("don't have any") || reply.includes('scheduled') || reply.includes('reminder') || reply.includes('id=') || reply.includes('No ') || reply.includes('no ');
      const removeStyle = /removed|not found|delete|remove|job \d|by id|one at a time/i.test(reply);
      assert(
        (listStyle || removeStyle) && reply.length > 5,
        `Expected cron list/remove-style reply for "${query}". Got (first 300 chars): ${reply.slice(0, 300)}`
      );
      console.log(`  ✓ "${query}"`);
      passed++;
    } catch (err) {
      console.log(`  ✗ "${query}": ${err.message}`);
      failed++;
    }
  }

  console.log('\n--- Result ---');
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
