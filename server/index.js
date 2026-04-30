require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const { scrapeUrl } = require('./scraper');
const { buildReviewPrompt } = require('./prompt');
const { generateReview, generateProductKeywords, RECOMMENDED_MODELS } = require('./openrouter');
const { parseXlsx, parsePastedLine } = require('./xlsxParser');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));

// ── Models ────────────────────────────────────────────────────────────────────
app.get('/api/models', (_req, res) => res.json(RECOMMENDED_MODELS));

// ── Scrape (platform-aware) ───────────────────────────────────────────────────
// Returns { productName, keywords, usedFallbackKeywords } where
// `usedFallbackKeywords: true` signals the client to upgrade keywords via
// /api/generate-keywords (which calls the user's own LLM).
app.post('/api/scrape', async (req, res) => {
  const { url, platform = 'capterra' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const result = await scrapeUrl(url, platform);
    res.json(result);
  } catch (err) {
    console.error('Scrape error:', err.message);
    res.status(500).json({ error: 'Failed to scrape URL: ' + err.message });
  }
});

// ── Batch scrape: scrape multiple URLs concurrently ───────────────────────────
app.post('/api/scrape-batch', async (req, res) => {
  const { items, platform = 'capterra' } = req.body;
  // items: [{ url, index }]
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items[] required' });

  const results = await Promise.allSettled(
    items.map(async item => {
      if (!item.url || !item.url.trim()) {
        return { index: item.index, productName: '', keywords: [], usedFallbackKeywords: false };
      }
      const data = await scrapeUrl(item.url.trim(), platform);
      return { index: item.index, ...data };
    }),
  );

  res.json(
    results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : {
            index: items[i].index,
            productName: '',
            keywords: [],
            usedFallbackKeywords: false,
            error: r.reason?.message,
          },
    ),
  );
});

// ── AI-generated, product-specific keywords ──────────────────────────────────
// Called by the client when /api/scrape returns usedFallbackKeywords: true.
// Uses the user's own OpenRouter key — never stored on the server.
app.post('/api/generate-keywords', async (req, res) => {
  const { apiKey, model, productName, platform = 'capterra' } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'OpenRouter API key required' });
  if (!model) return res.status(400).json({ error: 'Model required' });
  if (!productName) return res.status(400).json({ error: 'Product name required' });

  try {
    const keywords = await generateProductKeywords(apiKey, model, productName, platform);
    res.json({ keywords });
  } catch (err) {
    console.error('Keyword AI error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Parse XLSX ────────────────────────────────────────────────────────────────
app.post('/api/parse-xlsx', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const profiles = parseXlsx(req.file.buffer);
    res.json({ profiles });
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse XLSX: ' + err.message });
  }
});

// ── Parse pasted line ─────────────────────────────────────────────────────────
app.post('/api/parse-line', (req, res) => {
  const { line } = req.body;
  if (!line) return res.status(400).json({ error: 'Line required' });
  try {
    const profile = parsePastedLine(line);
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse line: ' + err.message });
  }
});

// ── Generate single review ────────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { apiKey, model, profile, productName, keywords, platform = 'capterra' } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'OpenRouter API key required' });
  if (!model) return res.status(400).json({ error: 'Model required' });
  if (!profile) return res.status(400).json({ error: 'Profile required' });
  if (!productName) return res.status(400).json({ error: 'Product name required' });

  try {
    const prompt = buildReviewPrompt(profile, productName, keywords || [], platform);
    const review = await generateReview(apiKey, model, prompt);
    res.json({ review });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Batch generate: iterate product rows concurrently ────────────────────────
// Each item: { productName, keywords, platform }
app.post('/api/generate-batch', async (req, res) => {
  const { apiKey, model, profile, products } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'OpenRouter API key required' });
  if (!model) return res.status(400).json({ error: 'Model required' });
  if (!profile) return res.status(400).json({ error: 'Profile required' });
  if (!Array.isArray(products) || !products.length) return res.status(400).json({ error: 'products[] required' });

  const results = await Promise.allSettled(
    products.map(async (p, i) => {
      const prompt = buildReviewPrompt(profile, p.productName, p.keywords || [], p.platform || 'capterra');
      const review = await generateReview(apiKey, model, prompt);
      return { index: i, productName: p.productName, platform: p.platform || 'capterra', review };
    }),
  );

  res.json(
    results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : {
            index: i,
            productName: products[i].productName,
            platform: products[i].platform || 'capterra',
            error: r.reason?.message,
          },
    ),
  );
});

// ── Fallback ──────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  const indexPath = path.join(clientDist, 'index.html');
  res.sendFile(indexPath, err => { if (err) res.status(404).send('Not found'); });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ReviewGen server → http://localhost:${PORT}`));
