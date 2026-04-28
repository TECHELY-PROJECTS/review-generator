# ReviewGen — AI-powered Software Review Generator

Generate human-style, role-based software reviews for Capterra, G2, and SoftwareReviews using OpenRouter AI.

## Features
- Upload XLSX or paste a tab-separated row line
- Paste Capterra / G2 / SoftwareReviews URL → auto-extracts product name + suggested topics
- Generate first-person, role-aware reviews with one click
- Click any section to copy just that value
- Supports multiple AI models via OpenRouter
- **Lightweight scraper** (no headless browser) → runs on free hosting tiers

## Setup

### 1. Install dependencies
```bash
npm run install:all
```

### 2. Configure (optional)
```bash
cp .env.example .env
```
Edit `.env` only if you need a custom port. The OpenRouter API key is entered in the UI and saved **in the browser** (localStorage) — never sent to your server.

## Development (two terminals)

**Terminal 1 — Backend:**
```bash
npm run dev:server
```

**Terminal 2 — Frontend:**
```bash
npm run dev:client
```

Open: http://localhost:5173

## Production Build

```bash
npm run build
npm start
```

Runs at: http://localhost:3001

---

## Free Hosting on Render

The app is designed to run on Render's free web service tier (512MB RAM).

### Option A — One-click deploy via render.yaml (recommended)

1. Push this project to a GitHub repository.
2. Go to https://dashboard.render.com → **New** → **Blueprint**.
3. Connect your GitHub repo. Render detects `render.yaml` and configures everything.
4. Click **Apply**. First deploy takes ~3–5 minutes.
5. Open the assigned `https://reviewgen-XXXX.onrender.com` URL.

### Option B — Manual setup

1. Push to GitHub.
2. Render dashboard → **New** → **Web Service** → connect your repo.
3. Settings:
   - **Environment:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Plan:** Free
   - **Node Version:** 20 (under Environment → add `NODE_VERSION=20`)
4. Click **Create Web Service**.

### Keeping the free instance awake

Render's free tier sleeps after **15 minutes of inactivity**. The first request after sleep takes 30–60 seconds (cold start). To keep it warm:

- Use a free uptime ping service like **UptimeRobot** or **Cron-Job.org**
- Configure it to ping `https://your-app.onrender.com/api/models` every **10 minutes**
- This keeps the instance warm 24/7 and stays well within the free tier limits

---

## Hosting on Hostinger Shared Business Hosting (Node.js)

If your Hostinger Business plan supports Node.js apps:

1. In hPanel, go to **Advanced → Node.js**.
2. Create a new Node.js app:
   - **Node version:** 18.x or 20.x
   - **Application root:** e.g. `reviewgen`
   - **Application URL:** your domain or subdomain
   - **Application startup file:** `server/index.js`
3. Upload the project files (or use Git deployment) into the application root.
4. In the Node.js app panel, click **Run NPM Install**.
5. Open the SSH terminal (Hostinger → Advanced → SSH access) and run:
   ```bash
   cd ~/reviewgen
   npm run build
   ```
6. In the Node.js panel, click **Restart**.
7. Visit your domain — the app should be live.

> **Note:** Shared hosting limits memory and concurrent requests. Heavy batch generation may be slow. If you outgrow it, Render free or a Hostinger KVM VPS is the next step.

---

## Scraping Behavior

This version uses a lightweight HTTP scraper (cheerio) instead of a headless browser. It extracts product name + keywords from:
- Open Graph / Twitter Card meta tags
- `<title>` and `<h1>` tags
- JSON-LD structured data
- Platform-specific badge selectors (where available in raw HTML)

Some Capterra/G2 pages are heavily JavaScript-rendered. For those, the **product name** is almost always recovered (it's in og:title or the page title), but **keywords may be empty**. When that happens, you can still type the product name and topics manually — the AI generation works exactly the same.

## XLSX Format
Expected columns (order matters, headers auto-detected):
| EMAIL | NAME | POSITION | COMPANY | Company Size | Industry | Job Function |

## Models (via OpenRouter)
- **Claude Opus 4** — Best for natural, varied human writing *(recommended)*
- **Claude Sonnet 4.5** — Fast + great tone variation
- **Gemini 2.5 Pro** — Strong persona-based writing
- **GPT-4o** — Reliable instruction following
- Plus Hunyuan 3 (free), Llama 4 Maverick, Kimi K2.6
