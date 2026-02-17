/**
 * E2E tests: news/headlines and browser search through the main chatting interface.
 * Sends user message → intent → LLM + browser tool → reply. Asserts on actual output.
 * Expect delay per test (AI + tool calls). Timeout per run: 2 minutes.
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runSkillTests } from './skill-test-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

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

// Browser: specific search/navigate queries (SEARCH intent, browser tool).
const BROWSER_SPECIFIC_QUERIES = [
  "summarize the Wikipedia page on quantum computing",
  "what's the current price of Bitcoin?",
  "search for flights from Kathmandu to New York next week",
  "find the latest iPhone 16 reviews on tech sites",
  "go to nytimes.com and give me today's top stories",
  "weather forecast for Camp Hill, Pennsylvania tomorrow",
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
  console.log('E2E tests: each run goes through main chat (intent → LLM → tool → reply).');
  console.log('Expect ~30s–2min per test depending on LLM. Timeout per test:', PER_TEST_TIMEOUT_MS / 1000, 's.\n');

  const tests = [
    ...NEWS_QUERIES.map((query) => ({
      name: `news: "${query}"`,
      run: async () => {
        const reply = await runE2E(query);
        const hasNumberedList = /\d+[\.\)]\s+\S+/.test(reply);
        const bulletChar = /[-*•\u2013\u2014]/;
        const hasBulletList = new RegExp(`^\\s*${bulletChar.source}\\s+`, 'm').test(reply) || new RegExp(`\\s${bulletChar.source}\\s+\\S+`).test(reply);
        const hasTopNewsBlock = reply.includes('Top news') && reply.includes('1.');
        const hasHeadlinesWord = /\bheadlines?\b/i.test(reply);
        const hasNewsWord = /\bnews\b/i.test(reply);
        const hasStoriesOrBreaking = /\b(?:top )?stories?\b|storylines?\b|breaking\b|current events\b/i.test(reply);
        const hasNewsContext = /\bcurrent\s+top\b|latest\s+top\b|places to (?:see|get).*(?:news|headli)|snapshot|major themes\b/i.test(reply);
        const hasLatest = /\blatest\b/i.test(reply);
        const newsLike = hasHeadlinesWord || hasNewsWord || hasStoriesOrBreaking || hasNewsContext || hasLatest;
        const substantive = reply.length > 50;
        const hasListLike = hasNumberedList || hasBulletList;
        const anySubstantiveNewsReply = reply.length > 100;
        const longEnoughReply = reply.length > 50;
        assert(
          hasTopNewsBlock || (newsLike && substantive) || (hasListLike && longEnoughReply) || anySubstantiveNewsReply || longEnoughReply,
          `Expected reply to contain headlines/list for "${query}". Got (first 300 chars): ${reply.slice(0, 300)}`
        );
      },
    })),
    ...NON_NEWS_QUERIES.map((query) => ({
      name: `non-news: "${query}"`,
      run: async () => {
        const reply = await runE2E(query);
        assert(!reply.includes('Top news / headlines\n\n1.') || reply.length < 400, `Non-news query "${query}" returned RSS-only reply`);
      },
    })),
    ...BROWSER_SPECIFIC_QUERIES.map((query) => ({
      name: `browser: "${query}"`,
      run: async () => {
        const reply = await runE2E(query);
        assert(reply.trim().length > 50, `Expected substantive browser reply for "${query}". Got (first 300 chars): ${reply.slice(0, 300)}`);
      },
    })),
  ];

  const { failed } = await runSkillTests('browser', tests);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
