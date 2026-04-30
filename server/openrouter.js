const axios = require('axios');

// ─── Provider config ──────────────────────────────────────────────────────────
//
// Both OpenRouter and CometAPI speak the same OpenAI-compatible
// chat/completions protocol. They only differ in base URL and a couple of
// nice-to-have headers OpenRouter likes for attribution.
//
// Add another provider here by adding one entry — nothing else changes.
const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    extraHeaders: {
      'HTTP-Referer': 'https://review-generator.local',
      'X-Title': 'Review Generator',
    },
  },
  cometapi: {
    label: 'CometAPI',
    url: 'https://api.cometapi.com/v1/chat/completions',
    extraHeaders: {},
  },
};

function resolveProvider(name) {
  const key = String(name || 'openrouter').toLowerCase();
  return PROVIDERS[key] || PROVIDERS.openrouter;
}

// ─── Recommended models per provider ──────────────────────────────────────────
//
// Lists are deliberately short and focused on review-writing quality.
// CometAPI uses the OpenAI/Anthropic canonical IDs (e.g. `gpt-4o`,
// `claude-sonnet-4-20250514`). OpenRouter uses its own `vendor/model` slugs.
const RECOMMENDED_MODELS = {
  openrouter: [
    { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4 — Best overall for human-style writing', badge: 'DEFAULT' },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet — Fast, great for review writing', badge: '' },
    { id: 'openai/gpt-4o', name: 'GPT-4o — Strong instruction following, natural prose', badge: '' },
    { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6 — Excellent varied persona writing', badge: '' },
    { id: 'tencent/hy3-preview:free', name: 'Hunyuan 3 Preview — Free tier option', badge: 'FREE' },
    { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5 — Fast + excellent tone variation', badge: '' },
    { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro — Great role-based persona writing', badge: '' },
    { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick — Open source, varied style', badge: '' },
  ],
  cometapi: [
    { id: 'gpt-4o-mini', name: 'GPT-4o mini — Cheapest, great for keywords', badge: 'CHEAP' },
    { id: 'gpt-4o', name: 'GPT-4o — Strong, natural prose', badge: 'DEFAULT' },
    { id: 'chatgpt-4o-latest', name: 'ChatGPT-4o latest — Most human-feeling output', badge: '' },
    { id: 'claude-3-7-sonnet-latest', name: 'Claude 3.7 Sonnet — Excellent review writing', badge: '' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 — Newest, varied tone', badge: '' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro — Strong persona writing', badge: '' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash — Fast & cheap', badge: 'CHEAP' },
    { id: 'deepseek-v3.1', name: 'DeepSeek V3.1 — Very cheap, capable', badge: 'CHEAP' },
  ],
};

// Backwards compat: a flat list (kept so old client builds don't crash if they
// hit /api/models without ?provider). Defaults to OpenRouter.
const RECOMMENDED_MODELS_FLAT = RECOMMENDED_MODELS.openrouter;

// ─── Low-level chat call ──────────────────────────────────────────────────────
async function callChat({ apiKey, model, messages, provider, temperature = 0.85, maxTokens = 1400, timeoutMs = 90000 }) {
  const cfg = resolveProvider(provider);
  const response = await axios.post(
    cfg.url,
    { model, messages, temperature, max_tokens: maxTokens },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...cfg.extraHeaders,
      },
      timeout: timeoutMs,
    },
  );
  return response.data?.choices?.[0]?.message?.content || '';
}

// ─── Review generation ────────────────────────────────────────────────────────
async function generateReview(apiKey, model, prompt, provider = 'openrouter') {
  const content = await callChat({
    apiKey,
    model,
    provider,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.85,
    maxTokens: 1400,
  });

  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Failed to parse AI response as JSON: ' + cleaned.substring(0, 200));
  }
}

// ─── AI-generated, product-specific topics ────────────────────────────────────
const PLATFORM_LABELS = { capterra: 'Capterra', g2: 'G2', softwarereviews: 'SoftwareReviews' };

async function generateProductKeywords(apiKey, model, productName, platform = 'capterra', provider = 'openrouter') {
  if (!productName || !String(productName).trim()) throw new Error('productName required');
  const platformLabel = PLATFORM_LABELS[String(platform).toLowerCase()] || 'Capterra';

  const prompt = `You know the software product "${productName}".

List 10 SPECIFIC topics that a real user would naturally discuss in a ${platformLabel} review of this product — the actual features, capabilities, integrations, pain points, pricing factors, and workflows that genuinely apply to "${productName}".

Rules:
- Each topic 2 to 5 words.
- Be specific to "${productName}" — name real features, modules, or integrations where you can. Avoid empty phrases like "Ease of Use" or "Value for Money" unless the product has a notably distinctive angle on them.
- Mix positives, common complaints, and practical aspects so a review built from these feels balanced.
- Do NOT include "${productName}" itself in any topic.
- Return ONLY a JSON array of 10 strings. No prose, no markdown, no code fences.

Example shape (do not copy the wording):
["Real-time collaboration","Block-based editor","Database views","Mobile sync reliability","Free tier limits","Template marketplace","API access","Permissions granularity","Offline mode gaps","Pricing for teams"]`;

  const content = await callChat({
    apiKey,
    model,
    provider,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    maxTokens: 400,
    timeoutMs: 60000,
  });

  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('AI did not return a JSON array of keywords');
    parsed = JSON.parse(m[0]);
  }

  if (!Array.isArray(parsed)) throw new Error('AI response was not a JSON array');

  const cleanList = parsed
    .map(k => (typeof k === 'string' ? k.trim() : ''))
    .filter(k => k.length >= 2 && k.length <= 60)
    .slice(0, 12);

  if (cleanList.length < 3) throw new Error('AI returned too few usable keywords');
  return cleanList;
}

module.exports = {
  generateReview,
  generateProductKeywords,
  RECOMMENDED_MODELS,
  RECOMMENDED_MODELS_FLAT,
  PROVIDERS,
};
