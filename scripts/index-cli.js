#!/usr/bin/env node
/**
 * Manual index runner: cowcode index [--source memory] [--source filesystem] [--root <path>] [--limit N]
 * Default (no --source): index all sources (memory + chat + filesystem).
 * --limit N: only index first N items (files for memory, directory-chunks for filesystem). Use for testing (e.g. --limit 10).
 * Requires memory skill enabled and embedding config.
 */

import dotenv from 'dotenv';
import { getEnvPath } from '../lib/paths.js';
import { getMemoryConfig } from '../lib/memory-config.js';
import { sync, indexFilesystem } from '../lib/memory-index.js';

// Load .env from state dir so API keys (e.g. LLM_1_API_KEY) are available
dotenv.config({ path: getEnvPath() });

const argv = process.argv.slice(2);
const sources = [];
let root = null;
let limit = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--source' && argv[i + 1]) {
    sources.push(String(argv[i + 1]).toLowerCase().trim());
    i++;
  } else if (argv[i] === '--root' && argv[i + 1]) {
    root = String(argv[i + 1]).trim();
    i++;
  } else if (argv[i] === '--limit' && argv[i + 1]) {
    limit = Math.max(1, Math.floor(Number(argv[i + 1])) || 1);
    i++;
  }
}

const wantAll = sources.length === 0;
const wantMemory = wantAll || sources.includes('memory');
const wantFilesystem = wantAll || sources.includes('filesystem');

async function main() {
  const config = getMemoryConfig();
  if (!config) {
    console.error('cowcode index: Memory is not enabled. Add "memory" to skills.enabled in config and set an embedding API key.');
    process.exit(1);
  }

  if (wantMemory) {
    console.log('[index] Syncing memory and chat-log...');
    await sync(config, {
      onFile: (relPath) => console.log('[index]', relPath),
      ...(limit != null ? { maxFiles: limit } : {}),
    });
  }

  if (wantFilesystem) {
    console.log('[index] Indexing filesystem...');
    if (limit != null) console.log('[index] Limit:', limit, 'directory chunks');
    await indexFilesystem(config, {
      ...(root ? { root } : {}),
      ...(limit != null ? { maxChunks: limit } : {}),
      onDir: (dirPath) => console.log('[index]', dirPath),
    });
  }

  if (!wantMemory && !wantFilesystem) {
    console.log('cowcode index: No sources selected. Use --source memory and/or --source filesystem, or run without --source to index all.');
  }
}

main().catch((err) => {
  console.error('cowcode index:', err && err.message ? err.message : err);
  process.exit(1);
});
