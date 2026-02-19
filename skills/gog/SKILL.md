---
name: gog
description: Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs.
homepage: https://gogcli.sh
---

# gog

Use `gog` to access Gmail, Calendar, Drive, Contacts, Sheets, and Docs.

Call `run_skill` with:
- skill: "gog"
- arguments.action: "run"
- arguments.argv: array of command parts (do not include `gog`)

Always use:
--json
--no-input

Never fabricate tool output.

---

## Arguments

- action: must be exactly "run"
- argv: array of strings for the gog command
- account: optional
- confirm: required for gmail send or calendar create/add/insert

Example:
["gmail","search","newer_than:7d","--max","5000","--json","--no-input"]

---

## Gmail Behavior Policy

Default mail scope:
- Use All Mail
- Exclude Sent
- Do not ask for scope clarification unless explicitly requested

Result retrieval:
- Use a sufficiently large --max (e.g. 5000) when analysis or counting is required
- Compute using retrieved results even if additional pages may exist
- Only warn about truncation if result count equals --max

Do not refuse execution solely due to pagination or nextPageToken.

---

## Execution Principles

- Prefer single decisive tool call when possible
- Do not negotiate default behavior
- Do not offer UI alternatives unless tool execution fails
- Provide computed answer directly after analysis
- Be concise and decisive
