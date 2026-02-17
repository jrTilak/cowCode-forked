# Browse

Control a **local headless browser** (Playwright/Chromium) on the user's machine. No cloud middleman. Use when the user wants to **go to a URL, interact with the page, or bring back proof** (e.g. open a site, click a button, fill a form, take a screenshot).

Call **run_skill** with **skill: "browse"**. Set **command** or **arguments.action** to one of: **navigate**, **click**, **scroll**, **fill**, **screenshot**.

## Commands

- **navigate** — Open a URL and return the page's text content. Set **arguments.url** (full http/https URL).
- **click** — Go to **arguments.url**, click an element, return the new page content. Set **arguments.selector** (CSS selector, e.g. `button.submit`, `a#sign-in`, `[aria-label="Submit"]`).
- **scroll** — Go to **arguments.url**, scroll the page. Set **arguments.direction** to one of: **down**, **up**, **top**, **bottom** (default: down).
- **fill** — Go to **arguments.url**, fill a form field. Set **arguments.selector** (e.g. `input[name=q]`, `#email`) and **arguments.value** (text to type).
- **screenshot** — Go to **arguments.url**, capture a screenshot (full page or element). Optional **arguments.selector** to capture only that element. Returns file path and a short page summary; screenshot is saved under `~/.cowcode/browse-screenshots/`.

## When to use Browse vs Search

- **Search** (skill "search"): find info — queries, news, weather, "what's out there". Text in, text out.
- **Browse** (skill "browse"): interact with the web — "open this URL", "click the login button", "fill the form", "screenshot this page". Go there, do that, bring back proof.

Never omit **arguments.url** for browse actions (except when continuing from a previous step; if in doubt, pass the URL again). Always use a valid CSS selector for **click** and **fill**.
