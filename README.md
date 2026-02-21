# cowCode

<div align="center">
  <img width="320" height="320" alt="cowCode" src="https://github.com/user-attachments/assets/7d245e10-8172-4956-bc29-aaba9e30aa10" />
</div>

**cowCode - your private AI companion**

🔒 Full control | 🖥 Runs on your computer | 🚫 No external routing | ⚙️ You decide what connects


---

## 1️⃣ Install · Mac, Linux, Windows

```bash
curl -fsSL https://raw.githubusercontent.com/bishwashere/cowCode/master/install.sh | bash
```

**Windows:** Use **Git Bash** and [Node.js](https://nodejs.org/). [Git Bash](https://gitforwindows.org/) if needed.

| 2️⃣ Start the Bot | 3️⃣ Dashboard | 4️⃣ Other commands |
|----------------------------------------|--------------|-------------------|
| <code>cowcode moo start</code> | <code>cowcode dashboard</code>  | <code>cowcode logs</code> - view bot logs<br><code>cowcode update</code> - latest version<br><code>cowcode uninstall</code> - remove cowCode |
| You can close the terminal. It keeps running. | Open dashboard | Other utility commands are here |

---

# 🔐 Private & Secure

* Runs locally on your machine
* WhatsApp and Telegram connect directly
* Config and data stay in `~/.cowcode`
* Local models are used first by default
* No external servers required

Your AI.
Your machine.
Your control.

---

# 📦 Where Things Live

**Code**

```
~/.local/share/cowcode
```

**Config, auth, reminders**

```
~/.cowcode
```

Everything stays on your computer.

---

# 🧠 What You Can Say

| Reminders & time | Search & browse | Vision & pages | Memory & files |
|------------------|-----------------|----------------|-----------------|
| remind me in 5 minutes | search for AI trends | describe what's on that page | summarize my notes |
| remind me tomorrow at 9am | what's the weather | show me what you see (webcam) | what did we decide yesterday? |
| every Monday at 8am remind me to standup | open example.com and tell me what's there | screenshot the page | what did I note about the project? |
| list my reminders | go to that URL, click the button | describe this image | read main.py |
| cancel reminder number 2 | fill the form and submit | what's in the room? | save this to notes.md |
| set a reminder in 2 hours for groceries | find news about X | take a screenshot | in config.json replace X with Y |
| what's scheduled? | scroll down the page | what do you see? | list files in my workspace |


---

# ⚙️ Requirements

* Node.js 18+
* Local LLM running (LM Studio, Ollama, etc.)
* Or cloud API key

---

# 🌊 Tide (periodic check)

Tide runs the agent on a schedule to check for pending tasks or follow-ups (no user message needed). Enable and set the interval in `~/.cowcode/config.json`:

```json
"tide": {
  "enabled": true,
  "intervalMinutes": 30,
  "jid": "YOUR_WHATSAPP_JID_OR_TELEGRAM_CHAT_ID"
}
```

* **enabled** — `true` to run tide; `false` or omit to disable.
* **intervalMinutes** — How often to run (default 30). Minimum 1.
* **jid** — Where to send the agent’s reply (your WhatsApp JID or Telegram chat id). If omitted, the agent still runs but no message is sent.

---

# 📌 That's It

Private.
Secure.
Runs on your computer.
Works with WhatsApp and Telegram.
Easy to install.
Easy to update.

cowCode keeps AI simple.

Paths are relative to the workspace (`~/.cowcode/workspace/`) unless absolute.

---
