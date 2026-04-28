/**
 * Platform-specific review prompt builder
 * Platforms: capterra | g2 | softwarereviews
 */

// ─── Platform output schemas ───────────────────────────────────────────────────
const PLATFORM_SCHEMAS = {
  capterra: {
    label: 'Capterra',
    fields: ['title', 'pros', 'cons', 'overall'],
    instructions: `OUTPUT FORMAT — return ONLY this JSON, no extra text, no markdown code blocks:
{
  "title": "...",
  "pros": "...",
  "cons": "...",
  "overall": "..."
}`,
    limits: `- Title: 10-18 words max (no quotes, just the headline)
   - Pros: 2-4 sentences
   - Cons: 2-3 sentences
   - Overall: 2-4 sentences`,
  },

  softwarereviews: {
    label: 'SoftwareReviews',
    fields: ['title', 'pros', 'cons', 'additionalFeature', 'whatMakesDifferent', 'suggestion'],
    instructions: `OUTPUT FORMAT — return ONLY this JSON, no extra text, no markdown code blocks:
{
  "title": "...",
  "pros": "...",
  "cons": "...",
  "additionalFeature": "...",
  "whatMakesDifferent": "...",
  "suggestion": "..."
}`,
    limits: `- Title: 10-18 words max (no quotes, just the headline)
   - Pros: 2-4 sentences
   - Cons: 2-3 sentences
   - Additional Feature I'd Like to See: 1-2 sentences
   - What Makes It Different: 2-3 sentences
   - Suggestion: 1-2 sentences`,
  },

  g2: {
    label: 'G2',
    fields: ['title', 'pros', 'cons', 'problemsSolving'],
    instructions: `OUTPUT FORMAT — return ONLY this JSON, no extra text, no markdown code blocks:
{
  "title": "...",
  "pros": "...",
  "cons": "...",
  "problemsSolving": "..."
}`,
    limits: `- Title: 10-18 words max (no quotes, just the headline)
   - Pros: 2-4 sentences
   - Cons: 2-3 sentences
   - Problems it's solving & benefiting: 2-4 sentences (explain specific workflow problems it solves and the concrete business benefit)`,
  },
};

function buildReviewPrompt(profile, productName, keywords, platform = 'capterra') {
  const { name, position, company, companySize, industry, jobFunction } = profile;
  const schema = PLATFORM_SCHEMAS[platform.toLowerCase()] || PLATFORM_SCHEMAS.capterra;

  const keywordList =
    keywords.length > 0
      ? keywords.map(k => `- ${k}`).join('\n')
      : '- General usability\n- Value for money\n- Customer support';

  return `You are a real professional writing a genuine software review for ${schema.label}. You are writing as ${name}, a ${position} at ${company} (${companySize}, ${industry} industry, ${jobFunction} department).

Your job is to write a completely authentic, first-person review of "${productName}" that sounds exactly like this real person wrote it — not AI, not a template.

STRICT RULES:
1. Write ONLY from ${name}'s perspective as a ${position}. Language, vocabulary, concerns and priorities must match someone in this exact role at a ${companySize} ${industry} company.
2. NEVER use generic filler phrases: "game changer", "seamlessly", "robust", "leverage", "streamline", "powerful tool", "user-friendly", "intuitive". Write how a real professional speaks.
3. Every section must feel written by a DIFFERENT person with a DIFFERENT voice. Vary sentence length, style, tone.
4. Weave these specific topics naturally into the review (do NOT force them as headers):
${keywordList}
5. A Founder writes differently than an IT Administrator. A Legal professional writes differently than a Marketing Strategist. A 2-10 person company has different pain points than a 200+ company. Reflect this.
6. Keep it specific. Mention real use cases a ${position} in ${industry} would face. No vague statements.
7. The review must pass AI detection — vary sentence structure, use occasional imperfect grammar, include lived-in specific details.
8. Character limits per section:
   ${schema.limits}

${schema.instructions}`;
}

module.exports = { buildReviewPrompt, PLATFORM_SCHEMAS };
