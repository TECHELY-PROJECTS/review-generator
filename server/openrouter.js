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

module.exports = { generateReview, RECOMMENDED_MODELS };
