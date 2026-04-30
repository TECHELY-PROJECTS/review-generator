const axios = require('axios');

const RECOMMENDED_MODELS = [
  {
    id: 'anthropic/claude-opus-4',
    name: 'Claude Opus 4 — Best overall for human-style writing',
    badge: 'DEFAULT',
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet — Fast, great for review writing',
    badge: '',
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o — Strong instruction following, natural prose',
    badge: '',
  },
  {
    id: 'moonshotai/kimi-k2.6',
    name: 'Kimi K2.6 — Excellent varied persona writing',
    badge: '',
  },
  {
    id: 'tencent/hy3-preview:free',
    name: 'Hunyuan 3 Preview — Free tier option',
    badge: 'FREE',
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5 — Fast + excellent tone variation',
    badge: '',
  },
  {
    id: 'google/gemini-2.5-pro-preview',
    name: 'Gemini 2.5 Pro — Great role-based persona writing',
    badge: '',
  },
  {
    id: 'meta-llama/llama-4-maverick',
    name: 'Llama 4 Maverick — Open source, varied style',
    badge: '',
  },
];

async function generateReview(apiKey, model, prompt) {
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.85,
      max_tokens: 1400,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://review-generator.local',
        'X-Title': 'Review Generator',
      },
      timeout: 90000,
    },
  );

  const content = response.data.choices[0].message.content;
  let cleaned = content.trim();
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
//
// When the page scraper is blocked (e.g. Cloudflare on Capterra/G2), we use the
// LLM to generate the topics real users would discuss when reviewing the
// product. These are far better than the generic "Ease of Use, Value for Money"
// platform criteria — the AI knows what a real review of, say, Notion or
// QuickBooks actually covers.

const PLATFORM_LABELS = {
  capterra: 'Capterra',
  g2: 'G2',
  softwarereviews: 'SoftwareReviews',
};

async function generateProductKeywords(apiKey, model, productName, platform = 'capterra') {
  if (!productName || !String(productName).trim()) {
    throw new Error('productName required');
  }
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

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 400,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://review-generator.local',
        'X-Title': 'Review Generator',
      },
      timeout: 60000,
    },
  );

  const content = response.data.choices[0].message.content || '';
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Try strict JSON first, then fall back to extracting the first [...] block.
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

module.exports = { generateReview, generateProductKeywords, RECOMMENDED_MODELS };
