/**
 * Browse executor: local browser control via Playwright (Chromium + CDP).
 * Navigate, click, scroll, fill forms, screenshot — no cloud, no external search API.
 * The agent puppeteers a real headless browser on the user's machine.
 */

import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { getStateDir } from '../paths.js';

const BROWSER_TIMEOUT_MS = 25_000;
const MAX_PAGE_TEXT_CHARS = 14_000;

function stripHtmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getScreenshotsDir() {
  const dir = join(getStateDir(), 'browse-screenshots');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

async function runWithBrowser(fn) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(BROWSER_TIMEOUT_MS);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

function ensureUrl(url) {
  const u = url && String(url).trim();
  if (!u) throw new Error('url is required');
  if (!u.startsWith('http://') && !u.startsWith('https://')) throw new Error('url must start with http:// or https://');
  return u;
}

/**
 * @param {object} ctx - unused
 * @param {object} args - LLM tool args: action, url?, selector?, value?, direction?
 * @returns {Promise<string>}
 */
export async function executeBrowse(ctx, args) {
  const action = (args?.action && String(args.action).trim().toLowerCase()) || 'navigate';

  if (action === 'navigate') {
    const url = ensureUrl(args?.url);
    return runWithBrowser(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS });
      const html = await page.content();
      const text = stripHtmlToText(html);
      const out = text.slice(0, MAX_PAGE_TEXT_CHARS);
      return (out || 'Page loaded; no extractable text.') + (text.length > MAX_PAGE_TEXT_CHARS ? '\n[... truncated]' : '');
    });
  }

  if (action === 'click') {
    const url = ensureUrl(args?.url);
    const selector = args?.selector && String(args.selector).trim();
    if (!selector) throw new Error('selector is required for click (e.g. "button.submit", "a#link", "[aria-label=Submit]")');
    return runWithBrowser(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS });
      await page.waitForSelector(selector, { state: 'visible', timeout: 10_000 }).catch(() => {
        throw new Error(`Element not found or not visible: ${selector}`);
      });
      await page.click(selector);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      const html = await page.content();
      const text = stripHtmlToText(html);
      const out = text.slice(0, MAX_PAGE_TEXT_CHARS);
      return 'Clicked. Page content:\n\n' + (out || 'No text.') + (text.length > MAX_PAGE_TEXT_CHARS ? '\n[... truncated]' : '');
    });
  }

  if (action === 'scroll') {
    const url = ensureUrl(args?.url);
    const direction = (args?.direction && String(args.direction).trim().toLowerCase()) || 'down';
    return runWithBrowser(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS });
      const delta = direction === 'up' ? -400 : direction === 'top' ? -1e9 : direction === 'bottom' ? 1e9 : 400;
      if (delta === -1e9 || delta === 1e9) {
        await page.evaluate((d) => window.scrollBy(0, d), delta);
      } else {
        await page.mouse.wheel(0, delta);
      }
      await new Promise((r) => setTimeout(r, 800));
      const html = await page.content();
      const text = stripHtmlToText(html);
      const out = text.slice(0, MAX_PAGE_TEXT_CHARS);
      return 'Scrolled ' + direction + '.\n\n' + (out || 'No text.') + (text.length > MAX_PAGE_TEXT_CHARS ? '\n[... truncated]' : '');
    });
  }

  if (action === 'fill') {
    const url = ensureUrl(args?.url);
    const selector = args?.selector && String(args.selector).trim();
    const value = args?.value != null ? String(args.value) : '';
    if (!selector) throw new Error('selector is required for fill (e.g. "input[name=q]", "#email")');
    return runWithBrowser(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS });
      await page.waitForSelector(selector, { state: 'visible', timeout: 10_000 }).catch(() => {
        throw new Error(`Element not found or not visible: ${selector}`);
      });
      await page.fill(selector, value);
      await new Promise((r) => setTimeout(r, 500));
      const html = await page.content();
      const text = stripHtmlToText(html);
      const out = text.slice(0, MAX_PAGE_TEXT_CHARS);
      return 'Filled field. Page content:\n\n' + (out || 'No text.') + (text.length > MAX_PAGE_TEXT_CHARS ? '\n[... truncated]' : '');
    });
  }

  if (action === 'screenshot') {
    const url = ensureUrl(args?.url);
    const selector = args?.selector && String(args.selector).trim();
    return runWithBrowser(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `browse-${stamp}.png`;
      const dir = getScreenshotsDir();
      const filepath = join(dir, filename);
      if (selector) {
        const el = await page.waitForSelector(selector, { state: 'visible', timeout: 10_000 }).catch(() => null);
        if (el) await el.screenshot({ path: filepath }); else await page.screenshot({ path: filepath, fullPage: true });
      } else {
        await page.screenshot({ path: filepath, fullPage: true });
      }
      const html = await page.content();
      const text = stripHtmlToText(html).slice(0, 800);
      const scope = selector ? `element "${selector}"` : 'full page';
      return [
        'Screenshot captured.',
        'Details:',
        `  Saved to: ${filepath}`,
        `  Filename: ${filename}`,
        `  Scope: ${scope}`,
        `  URL: ${url}`,
        '',
        'Page summary: ' + (text || 'No text.'),
      ].join('\n');
    });
  }

  throw new Error(`Unknown browse action: ${action}. Use one of: navigate, click, scroll, fill, screenshot.`);
}
