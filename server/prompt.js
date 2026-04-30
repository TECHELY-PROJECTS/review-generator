/**
 * Platform-specific review prompt builder
 * Platforms: capterra | g2 | g2service | softwarereviews
 *
 * Universal word limits (per spec):
 *   - Title:               6-10 words
 *   - Cons / dislikes:     40-60 words
 *   - All other sections:  60-70 words
 */

const WORD_LIMITS = {
  title: '6-10 words',
  cons:  '40-60 words',
  body:  '60-70 words',
};

const PLATFORM_SCHEMAS = {
  capterra: {
    label: 'Capterra',
    contentType: 'software',
    subjectWord: 'software',
    fields: [
      { key: 'title',   limit: WORD_LIMITS.title, label: 'Title (review headline)' },
      { key: 'pros',    limit: WORD_LIMITS.body,  label: 'Pros (what you like best about {NAME})' },
      { key: 'cons',    limit: WORD_LIMITS.cons,  label: 'Cons (what you dislike about {NAME})' },
      { key: 'overall', limit: WORD_LIMITS.body,  label: 'Overall impression of {NAME}' },
    ],
  },

  // Existing G2 (software products)
  g2: {
    label: 'G2 (Software)',
    contentType: 'software',
    subjectWord: 'software',
    fields: [
      { key: 'title',           limit: WORD_LIMITS.title, label: 'Title (review headline)' },
      { key: 'pros',            limit: WORD_LIMITS.body,  label: 'What do you like best about {NAME}?' },
      { key: 'cons',            limit: WORD_LIMITS.cons,  label: 'What do you dislike about {NAME}?' },
      { key: 'problemsSolving', limit: WORD_LIMITS.body,  label: "What problems is {NAME} solving and how is that benefiting you?" },
    ],
  },

  // NEW: G2 services (agencies, consultancies, providers)
  g2service: {
    label: 'G2 (Service)',
    contentType: 'service',
    subjectWord: 'service',
    fields: [
      { key: 'title',            limit: WORD_LIMITS.title, label: 'Title (review headline)' },
      { key: 'problemsSolving',  limit: WORD_LIMITS.body,  label: 'What problems is {NAME} solving and how is that benefiting you?' },
      { key: 'whatYouLikeBest',  limit: WORD_LIMITS.body,  label: 'What do you like best about {NAME}?' },
      { key: 'dislikes',         limit: WORD_LIMITS.cons,  label: 'What do you dislike about {NAME}?' },
      { key: 'recommendations',  limit: WORD_LIMITS.body,  label: 'Recommendations to others considering {NAME}' },
    ],
  },

  softwarereviews: {
    label: 'SoftwareReviews',
    contentType: 'software',
    subjectWord: 'software',
    fields: [
      { key: 'title',              limit: WORD_LIMITS.title, label: 'Title (review headline)' },
      { key: 'pros',               limit: WORD_LIMITS.body,  label: 'Pros' },
      { key: 'cons',               limit: WORD_LIMITS.cons,  label: 'Cons' },
      { key: 'additionalFeature',  limit: WORD_LIMITS.body,  label: "Additional feature you'd like to see in {NAME}" },
      { key: 'whatMakesDifferent', limit: WORD_LIMITS.body,  label: 'What makes {NAME} different from competitors' },
      { key: 'suggestion',         limit: WORD_LIMITS.body,  label: 'Suggestion to the {NAME} vendor' },
    ],
  },
};

function resolveSchema(platform) {
  const key = String(platform || 'capterra').toLowerCase();
  return PLATFORM_SCHEMAS[key] || PLATFORM_SCHEMAS.capterra;
}

function buildReviewPrompt(profile, productName, keywords, platform = 'capterra') {
  const { name, position, company, companySize, industry, jobFunction } = profile;
  const schema = resolveSchema(platform);
  const isService = schema.contentType === 'service';
  const subjectWord = schema.subjectWord;

  const keywordList =
    keywords.length > 0
      ? keywords.map(k => `- ${k}`).join('\n')
      : '- General usability\n- Value for money\n- Customer support';

  // Build the JSON output spec dynamically from fields.
  const jsonSchema =
    '{\n' + schema.fields.map(f => `  "${f.key}": "..."`).join(',\n') + '\n}';

  // Per-section word-count rules with the actual product/service name substituted.
  const limitsBlock = schema.fields
    .map(f => `   - ${f.label.replace(/{NAME}/g, productName)}: ${f.limit}`)
    .join('\n');

  // Tone guidance differs for software vs service reviews.
  const reviewTypeGuidance = isService
    ? `This is a SERVICE review (the subject is an agency / consultancy / service provider — NOT a software product). Focus on people, project delivery, communication, deliverables, account management, expertise, and outcomes. Do NOT describe it as a software product, do NOT mention features, UI, dashboards, or installation.`
    : `This is a SOFTWARE PRODUCT review. Refer to it as a software / platform / tool — NOT a service or agency.`;

  return `You are a real professional writing a genuine ${subjectWord} review for ${schema.label}. You are writing as ${name}, a ${position} at ${company} (${companySize}, ${industry} industry, ${jobFunction} department).

Your job is to write a completely authentic, first-person review of ${isService ? `the service "${productName}"` : `"${productName}"`} that sounds exactly like this real person wrote it — not AI, not a template.

STRICT RULES:
1. Write ONLY from ${name}'s perspective as a ${position}. Language, vocabulary, concerns and priorities must match someone in this exact role at a ${companySize} ${industry} company.
2. NEVER use generic filler phrases: "game changer", "seamlessly", "robust", "leverage", "streamline", "powerful tool", "user-friendly", "intuitive". Write how a real professional speaks.
3. Every section must feel written by a DIFFERENT person with a DIFFERENT voice. Vary sentence length, style, tone.
4. Weave these specific topics naturally into the review (do NOT force them as headers):
${keywordList}
5. A Founder writes differently than an IT Administrator. A Legal professional writes differently than a Marketing Strategist. A 2-10 person company has different pain points than a 200+ company. Reflect this.
6. Keep it specific. Mention real use cases a ${position} in ${industry} would face. No vague statements.
7. The review must pass AI detection — vary sentence structure, use occasional imperfect grammar, include lived-in specific details.
8. ${reviewTypeGuidance}
9. STRICT WORD LIMITS — count words carefully, stay STRICTLY within range. Do not exceed the upper bound or fall short of the lower bound:
${limitsBlock}

OUTPUT FORMAT — return ONLY this JSON object, no extra text, no markdown code blocks, no surrounding quotes:
${jsonSchema}`;
}

module.exports = { buildReviewPrompt, PLATFORM_SCHEMAS, WORD_LIMITS };
