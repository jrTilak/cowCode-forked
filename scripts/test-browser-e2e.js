/**
 * E2E tests for news/headlines: go through the main chatting interface.
 * Sends user message → intent → LLM + browser tool → reply. Asserts on actual output.
 * Expect delay per test (AI + tool calls). Timeout per run: 2 minutes.
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const E2E_REPLY_MARKER_START = 'E2E_REPLY_START';
const E2E_REPLY_MARKER_END = 'E2E_REPLY_END';
const PER_TEST_TIMEOUT_MS = 120_000;

// How a human would ask (full questions).
const NEWS_QUERIES = [
  "What's the latest news?",
  "Can you give me the top five headlines?",
  "What are the headlines today?",
  "Tell me the current news",
  "What's in the news this week?",
  "Give me five headlines",
];

const NON_NEWS_QUERIES = [
  "What's the weather in London?",
  "What is the capital of France?",
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

  console.log('E2E news tests: each run goes through main chat (intent → LLM → browser tool → reply).');
  console.log('Expect ~30s–2min per test depending on LLM. Timeout per test:', PER_TEST_TIMEOUT_MS / 1000, 's.\n');
  console.log('--- News (human questions) ---\n');

  for (const query of NEWS_QUERIES) {
    try {
      const reply = await runE2E(query);
      // End-to-end: we expect the final reply to the user to contain headline-like content
      // (either the raw RSS "Top news / headlines" or the LLM’s formatted list).
      const hasNumberedList = /\n\d+\.\s+.+/.test(reply) || /^\d+\.\s+.+/.test(reply) || /\b\d+\.\s+[^\s]/.test(reply);
      const hasTopNewsBlock = reply.includes('Top news') && reply.includes('1.');
      const hasHeadlinesWordAndList = reply.includes('headlines') && hasNumberedList;
      assert(
        hasTopNewsBlock || hasHeadlinesWordAndList || (hasNumberedList && reply.length > 100),
        `Expected reply to contain headlines/list for "${query}". Got (first 300 chars): ${reply.slice(0, 300)}`
      );
      console.log(`  ✓ "${query}"`);
      passed++;
    } catch (err) {
      console.log(`  ✗ "${query}": ${err.message}`);
      failed++;
    }
  }

  console.log('\n--- Non-news (sanity) ---\n');
  for (const query of NON_NEWS_QUERIES) {
    try {
      const reply = await runE2E(query);
      // Should not be the raw RSS block; can be search result, answer, or error.
      assert(
        !reply.includes('Top news / headlines\n\n1.') || reply.length < 400,
        `Non-news query "${query}" returned RSS-only reply`
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
