# Browser

Search the web or fetch a page. Call **run_skill** with **skill: "browser"** and **arguments** as below.

**Always set arguments.action to exactly one of: search, navigate. Never omit action.**

## arguments shape

- **action: "search"** — For current time, weather, date, latest news, or any live query. Set **arguments.query** (e.g. "current time", "weather in Tokyo", "latest news"). Use a clear, concrete query.
- **action: "navigate"** — When the user gives a specific URL to read. Set **arguments.url** (full http or https URL).

## Config

- Brave Search: set `BRAVE_API_KEY` in .env or `skills.browser.search.apiKey` in config.json.
- Without Brave: news queries use RSS; other queries fall back to Playwright + DuckDuckGo Lite.
