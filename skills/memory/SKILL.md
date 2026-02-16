# Memory

Semantic search and read over your notes in `MEMORY.md` and `memory/*.md` (e.g. `memory/2025-02-15.md`).

## Tools (pass `tool` in arguments: "memory_search" or "memory_get")

- **memory_search** — Set `tool: "memory_search"`, `query` (required). Optional: `maxResults`, `minScore`. Semantically search for prior work, decisions, preferences, or todos. Returns snippets with path and line range.
- **memory_get** — Set `tool: "memory_get"`, `path` (required, from memory_search). Optional: `from`, `lines`. Read a snippet by path and optional line range.

## Config

- Add `"memory"` to `skills.enabled`. Set an embedding API key (e.g. OpenAI) in .env; if omitted, the first LLM model's key is used.
- Workspace: `~/.cowcode/workspace/`. Create `MEMORY.md` and optionally `memory/*.md`.
