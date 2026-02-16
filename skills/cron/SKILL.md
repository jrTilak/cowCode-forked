# Cron

Manage reminders and scheduled messages. Call **run_skill** with **skill: "cron"** and **arguments** as below.

**Always set arguments.action to exactly one of: add, list, remove. Never omit action.**

## arguments shape

- **action: "list"** — Use when the user asks to list, see, or count reminders ("how many crons?", "list my reminders", "what's scheduled?"). Call once only. Do not also call add. No other fields needed.
- **action: "add"** — Only when the user explicitly asks to CREATE or SET a reminder. Set **arguments.job** with **message** (exactly what to remind) and **schedule**: for one-shot use `{ "kind": "at", "at": "<future ISO 8601>" }`, for recurring use `{ "kind": "cron", "expr": "0 8 * * *", "tz": "optional" }`. Never invent message text.
- **action: "remove"** — When the user asks to cancel a reminder. Set **arguments.jobId** (from a previous list result).

## Notes

- For multiple new reminders in one message, call run_skill(cron, add) once per reminder with different job.message and job.schedule.at.
- For "every one minute for the next three minutes" call add three times with three different "at" times.
