require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const { scrapeUrl } = require('./scraper');
const { buildReviewPrompt } = require('./prompt');
const {
  generateReview,
  generateProductKeywords,
  RECOMMENDED_MODELS,
  RECOMMENDED_MODELS_FLAT,
  PROVIDERS,
} = require('./openrouter');
const { parseXlsx, parsePastedLine } = require('./xlsxParser');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));

// ── Models ────────────────────────────────────────────────────────────────────
// GET /api/models           → flat list (back-compat: OpenRouter recommendations)
// GET /api/models?provider=openrouter | cometapi → that provider's list
// GET /api/providers        → metadata for the client provider dropdown
app.get('/api/models', (req, res) => {
  const p = (req.query.provider || '').toString().toLowerCase();
  if (p && RECOMMENDED_MODELS[p]) return res.json(RECOMMENDED_MODELS[p]);
  res.json(RECOMMENDED_MODELS_FLAT);
});

app.get('/api/providers', (_req, res) => {
  res.json(
    Object.entries(PROVIDERS).map(([id, cfg]) => ({ id, label: cfg.label })),
  );
});

// ── Scrape (platform-aware) ───────────────────────────────────────────────────
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

// ── Batch scrape ──────────────────────────────────────────────────────────────
app.post('/api/scrape-batch', async (req, res) => {
  const { items, platform = 'capterra' } = req.body;
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
// Body: { apiKey, model, productName, platform?, provider? }
// `provider` is "openrouter" (default) or "cometapi".
app.post('/api/generate-keywords', async (req, res) => {
  const { apiKey, model, productName, platform = 'capterra', provider = 'openrouter' } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  if (!model) return res.status(400).json({ error: 'Model required' });
  if (!productName) return res.status(400).json({ error: 'Product name required' });

  try {
    const keywords = await generateProductKeywords(apiKey, model, productName, platform, provider);
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
  const { apiKey, model, profile, productName, keywords, platform = 'capterra', provider = 'openrouter' } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  if (!model) return res.status(400).json({ error: 'Model required' });
  if (!profile) return res.status(400).json({ error: 'Profile required' });
  if (!productName) return res.status(400).json({ error: 'Product name required' });

  try {
    const prompt = buildReviewPrompt(profile, productName, keywords || [], platform);
    const review = await generateReview(apiKey, model, prompt, provider);
    res.json({ review });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Batch generate ────────────────────────────────────────────────────────────
app.post('/api/generate-batch', async (req, res) => {
  const { apiKey, model, profile, products, provider = 'openrouter' } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  if (!model) return res.status(400).json({ error: 'Model required' });
  if (!profile) return res.status(400).json({ error: 'Profile required' });
  if (!Array.isArray(products) || !products.length) return res.status(400).json({ error: 'products[] required' });

  const results = await Promise.allSettled(
    products.map(async (p, i) => {
      const prompt = buildReviewPrompt(profile, p.productName, p.keywords || [], p.platform || 'capterra');
      const review = await generateReview(apiKey, model, prompt, provider);
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
