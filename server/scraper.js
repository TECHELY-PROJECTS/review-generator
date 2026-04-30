const axios = require('axios');
const cheerio = require('cheerio');

// Multi-strategy scraper (no headless browser).
//
// Product name: resolved primarily from the URL (Strategy 0) using a robust
//   parser that handles all known Capterra/G2/SoftwareReviews URL shapes —
//   including locale prefixes (/in/, /uk/, /es/...), category prefixes,
//   sem-compare links, and trailing path segments. We never return a numeric
//   ID as a product name.
//
// Keywords: best-effort via three strategies:
//   1. Jina Reader proxy (r.jina.ai) — works for SoftwareReviews; usually
//      blocked by Cloudflare on Capterra / G2.
//   2. Direct HTTP + cheerio — meta tags, JSON-LD, platform selectors.
//      Also blocked on Capterra / G2.
//   3. Platform-standard review topics — generic last-resort. The response
//      flags this case via `usedFallbackKeywords: true` so the client can
//      upgrade these to product-specific topics using the AI model the user
//      already has configured.

// ─── Platform-standard review topics (generic last-resort) ───────────────────
const PLATFORM_DEFAULT_KEYWORDS = {
  capterra: [
    'Ease of Use',
    'Value for Money',
    'Customer Support',
    'Features',
    'Likelihood to Recommend',
    'Setup and Implementation',
    'Integration Capabilities',
    'Performance and Reliability',
    'Reporting and Analytics',
    'Overall Experience',
  ],
  g2: [
    'Ease of Use',
    'Quality of Support',
    'Ease of Setup',
    'Features',
    'Business Value Delivered',
    'Meets Requirements',
    'Ease of Admin',
    'Problems Solved',
    'Return on Investment',
    'Integration Options',
  ],
  // G2 SERVICE reviews are about agencies/consultancies/providers — not software.
  // Topics reflect what real users discuss when reviewing service engagements.
  g2service: [
    'Quality of Service',
    'Communication',
    'Project Management',
    'Responsiveness',
    'Expertise & Knowledge',
    'Meeting Deadlines',
    'Value for Money',
    'Strategic Insight',
    'Onboarding Experience',
    'Long-term Partnership',
  ],
  softwarereviews: [
    'Enables Productivity',
    'Reliable',
    'Performance and Reliability',
    'Ease of Use',
    'Vendor Support',
    'Contract Negotiation',
    'Product Impact',
    'Useful Complements',
    'Integration and Compatibility',
    'Innovation',
  ],
};

// ─── Strategy 0: URL-based product name (robust) ─────────────────────────────

// Path segments that are NEVER a product name on these review sites.
// We skip them while looking for the real product slug.
const STRUCTURAL_SEGMENTS = new Set([
  // platform routing words
  'p', 'software', 'reviews', 'review', 'products', 'product', 'app', 'apps',
  'services', 'service', 'agencies', 'agency', 'providers', 'provider',
  'compare', 'comparison', 'alternatives', 'pricing', 'features', 'demo',
  'profile', 'vendor', 'vendors', 'category', 'categories', 'directory',
  'sem-compare', 'sem', 'shortlist', 'integrations', 'about', 'company',
  // form / action words (e.g. /products/new/<UUID>/ — review-submission pages)
  'new', 'edit', 'submit', 'write', 'create', 'add', 'update', 'delete',
  'form', 'feedback', 'rate', 'rating', 'quality', 'start', 'step', 'invite',
  // common locale / region prefixes
  'in', 'uk', 'us', 'ca', 'au', 'nz', 'ie', 'es', 'de', 'fr', 'it', 'pt',
  'br', 'mx', 'jp', 'kr', 'cn', 'tw', 'hk', 'sg', 'my', 'th', 'id', 'ph',
  'ru', 'pl', 'tr', 'nl', 'be', 'se', 'no', 'dk', 'fi', 'gr', 'cz', 'hu',
  'ro', 'za', 'ar', 'cl', 'co', 'pe', 've', 'en', 'en-us', 'en-gb', 'en-in',
  'en-au', 'en-ca', 'es-es', 'es-mx', 'fr-fr', 'fr-ca', 'pt-br', 'de-de',
]);

function isNumericId(seg) {
  // Pure numeric or numeric-with-light-decoration like "100299", "100-299"
  if (!seg) return true;
  return /^[0-9]+$/.test(seg) || /^[0-9]+[-_][0-9]+$/.test(seg);
}

function isUuid(seg) {
  if (!seg) return false;
  // Standard 8-4-4-4-12 UUID, with or without hyphens
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
    /^[0-9a-f]{32}$/i.test(seg)
  );
}

function isLikelyProductSlug(seg) {
  if (!seg) return false;
  if (isNumericId(seg)) return false;
  if (isUuid(seg)) return false;
  const lc = seg.toLowerCase();
  if (STRUCTURAL_SEGMENTS.has(lc)) return false;
  // Slugs are usually 2+ chars and contain at least one letter
  if (seg.length < 2) return false;
  if (!/[a-zA-Z]/.test(seg)) return false;
  return true;
}

function slugToTitle(slug) {
  if (!slug) return '';
  // Decode URL-encoding just in case (e.g. %20)
  let s;
  try { s = decodeURIComponent(slug); } catch (_) { s = slug; }

  // Strip a leading numeric id glued to the slug, e.g. "100299-quickbooks-online"
  // → "quickbooks-online". Only strip if the rest still looks like a real slug.
  const idStripped = s.replace(/^[0-9]+[-_]+/, '');
  if (idStripped !== s && /[a-zA-Z]/.test(idStripped)) s = idStripped;

  // Preserve domain-style brands like "monday.com", "notion.so"
  if (/\.[a-zA-Z]{2,}$/.test(s)) {
    return s.replace(/[-_]/g, ' ');
  }

  return s
    .split(/[-_]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .trim();
}

// Anchor keywords: when present in the URL, the product slug comes AFTER them.
// e.g. /sem-compare/it-management/p/100299/QuickBooks-Online → product is after "p"
const ANCHOR_KEYWORDS = new Set([
  'p', 'software', 'reviews', 'review', 'products', 'product',
  // G2 services / agency directories — same parsing pattern, different vertical
  'services', 'service', 'agencies', 'agency', 'providers', 'provider',
]);

/**
 * Extract the product name from the URL.
 *
 * Two-pass algorithm:
 *   1. If the URL contains an "anchor" keyword (p/software/reviews/products),
 *      look at the segments AFTER it and return the first non-numeric, non-
 *      structural one. This correctly handles category-prefixed URLs like
 *      /sem-compare/it-management/p/100299/QuickBooks-Online/.
 *   2. Otherwise fall back to "first non-numeric, non-structural segment in
 *      the whole path", which handles SoftwareReviews-style /products/notion
 *      and a few odd shapes.
 *
 * In all cases we never return a numeric ID or a known locale/structural word.
 */
function extractNameFromUrl(rawUrl /*, platform */) {
  try {
    const u = new URL(rawUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return '';

    // Pass 1: find the LAST anchor in the path, then take the first valid
    // segment that follows it. Using the last anchor matters for URLs like
    // /reviews/100299/Name (anchor at index 0) and /sem-compare/.../p/.../Name
    // (anchor deeper in the path).
    let lastAnchorIdx = -1;
    for (let i = 0; i < parts.length; i++) {
      if (ANCHOR_KEYWORDS.has(parts[i].toLowerCase())) lastAnchorIdx = i;
    }
    if (lastAnchorIdx !== -1) {
      for (let j = lastAnchorIdx + 1; j < parts.length; j++) {
        if (isLikelyProductSlug(parts[j])) return slugToTitle(parts[j]);
      }
    }

    // Pass 2: walk from left to right, return the first segment that looks
    // like a slug.
    for (const seg of parts) {
      if (isLikelyProductSlug(seg)) return slugToTitle(seg);
    }
    return '';
  } catch (_) {
    return '';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanProductName(raw, platform) {
  if (!raw) return '';
  let name = String(raw).trim();

  // "Login or create an account to review Salesforce" → "Salesforce"
  const reviewMatch = name.match(/review\s+(.+)$/i);
  if (reviewMatch && reviewMatch[1]) name = reviewMatch[1].trim();

  // Strip site/section suffix after | or - or :
  name = name.split(/\s*[\|\-—–:]\s*/)[0].trim();

  // Strip trailing words like "Reviews 2024", "Customer Reviews", "Pricing", "Features"
  name = name
    .replace(/\s+(Customer\s+)?(Reviews?|Pricing|Features?|Software|Demo|Profile)\b.*$/i, '')
    .replace(/\s+\d{4}$/, '')
    .trim();

  // Strip platform name if accidentally appended
  if (platform === 'g2' || platform === 'g2service') name = name.replace(/\s*\|?\s*G2\s*$/i, '').trim();
  if (platform === 'capterra') name = name.replace(/\s*\|?\s*Capterra\s*$/i, '').trim();
  if (platform === 'softwarereviews' || platform === 'software_reviews') {
    name = name.replace(/\s*\|?\s*SoftwareReviews\s*$/i, '').trim();
  }

  // Defensive: if cleaning leaves us with only digits, treat as empty.
  if (/^[0-9]+$/.test(name)) return '';

  return name;
}

function isBlockedResponse(text) {
  if (!text) return true;
  const head = String(text).substring(0, 800);
  return /Just a moment|CAPTCHA|security verification|Access denied|Cloudflare|Attention Required|Please verify you are a human|Enable JavaScript and cookies/i.test(
    head,
  );
}

function isNavJunk(text) {
  if (/https?:/i.test(text)) return true;
  if (/\(https?:/i.test(text)) return true;
  if (/^(Write a Review|Compare|About Us|For Vendors|More|Sign In|Sign Up|Log In|Help|Privacy|Terms|Cookie)/i.test(text))
    return true;
  return false;
}

function dedupeKeywords(arr) {
  const seen = new Map();
  for (const k of arr) {
    const lc = k.toLowerCase();
    if (!seen.has(lc)) seen.set(lc, k);
  }
  return [...seen.values()];
}

// ─── Strategy 1: Jina Reader ──────────────────────────────────────────────────

async function fetchViaJina(url) {
  const res = await axios.get('https://r.jina.ai/' + url, {
    timeout: 25000,
    responseType: 'text',
    transformResponse: [d => d],
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });
  if (typeof res.data !== 'string' || isBlockedResponse(res.data)) return null;
  return res.data;
}

/**
 * Parse the "Consider covering these topics ..." chip line from Capterra
 * review-submission pages (/products/new/<UUID>/). Jina flattens the chips
 * into one space-separated line, so we tokenize and group greedily, allowing
 * one extra TitleCase word per topic and the connector pattern
 * "Cap <stop> Cap" (e.g. "Value for Money").
 */
function extractCapterraFormTopics(md) {
  const m = md.match(/Consider covering[^:\n]*:\s*\n+\s*(.+?)(?:\n\s*\n|$)/);
  if (!m) return [];
  const line = m[1].replace(/[*_`]/g, '').trim();
  const tokens = line.split(/\s+/);
  const stop = new Set(['for', 'of', 'to', 'and', 'the', '&', 'a', 'an', 'in', 'on', 'with']);
  const isCap = t => /^[A-Z][a-zA-Z&]*$/.test(t);
  const topics = [];
  let i = 0;
  while (i < tokens.length) {
    if (!isCap(tokens[i])) { i++; continue; }
    const parts = [tokens[i]];
    let j = i + 1;
    // Connector pattern: Cap <stop> Cap  →  e.g. "Value for Money"
    if (j + 1 < tokens.length && stop.has(tokens[j].toLowerCase()) && isCap(tokens[j + 1])) {
      parts.push(tokens[j], tokens[j + 1]);
      j += 2;
    } else if (j < tokens.length && isCap(tokens[j])) {
      // Adjacent Cap word — only attach if the word AFTER it isn't a stopword
      // (a stopword would mean the next word starts a new "Cap stop Cap" topic)
      const next2 = tokens[j + 1];
      if (!next2 || !stop.has(next2.toLowerCase())) {
        parts.push(tokens[j]);
        j += 1;
      }
    }
    topics.push(parts.join(' '));
    i = j;
  }
  return topics.filter(t => t.length >= 3 && t.length <= 55);
}

function parseJinaMarkdown(md, platform, knownName) {
  // Always try to extract the name from the markdown — page content beats URL
  // heuristics. Order: explicit "about <Name>?" form copy → first H1 → Title:
  let scrapedName = '';

  // Capterra review form has lines like "Pros: What did you like most about Marketo Engage?"
  // and "Describe your overall experience with Marketo Engage". Both are 100% reliable.
  const aboutMatch =
    md.match(/(?:like\s+(?:most|least|best)\s+about|experience\s+with|recommendations\s+to\s+others\s+considering)\s+([^?\n]{2,80}?)\s*[?\n]/i);
  if (aboutMatch) scrapedName = cleanProductName(aboutMatch[1], platform);

  if (!scrapedName) {
    const h1 = md.match(/^#\s+(.+)$/m);
    if (h1) {
      const candidate = cleanProductName(h1[1], platform);
      if (candidate && !/^(write a review|reviews?|home|welcome)$/i.test(candidate)) {
        scrapedName = candidate;
      }
    }
  }
  if (!scrapedName) {
    const titleLine = md.match(/^Title:\s*(.+)$/m);
    if (titleLine) {
      const candidate = cleanProductName(titleLine[1], platform);
      // Don't accept generic page titles like "Write a Review"
      if (candidate && !/^(write a review|reviews?|home|welcome)$/i.test(candidate)) {
        scrapedName = candidate;
      }
    }
  }

  // Prefer the scraped name (canonical, from the page itself). Fall back to
  // the URL-derived name only if scraping yielded nothing usable.
  const productName = scrapedName || knownName || '';

  // Keywords: bullet points first (most pages), then Capterra form chips.
  const keywords = [];
  const lines = md.split('\n');
  for (const ln of lines) {
    const t = ln.trim();
    const bullet = t.match(/^[-*]\s+(.{3,55})$/);
    if (bullet) {
      const v = bullet[1].replace(/[*_`[\]]/g, '').trim();
      if (
        !isNavJunk(v) &&
        v.length >= 3 &&
        v.length <= 55 &&
        /^[A-Z0-9]/.test(v) &&
        !/[.?!]$/.test(v) &&
        v.split(/\s+/).length <= 7
      ) {
        keywords.push(v);
      }
    }
  }

  // Capterra form-page chips (no bullets — flat space-separated line)
  if (keywords.length < 3) {
    keywords.push(...extractCapterraFormTopics(md));
  }

  return { productName, keywords: dedupeKeywords(keywords).slice(0, 12) };
}

// ─── Strategy 2: Direct HTTP + cheerio ───────────────────────────────────────

async function fetchDirect(url) {
  const res = await axios.get(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 12000,
    maxRedirects: 5,
    validateStatus: s => s >= 200 && s < 400,
  });
  if (typeof res.data !== 'string' || isBlockedResponse(res.data)) return null;
  return res.data;
}

function parseHtml(html, platform, knownName) {
  const $ = cheerio.load(html);

  let productName = knownName || '';
  if (!productName) {
    productName = cleanProductName($('meta[property="og:title"]').attr('content'), platform);
  }
  if (!productName) {
    productName = cleanProductName($('meta[name="twitter:title"]').attr('content'), platform);
  }
  if (!productName) productName = cleanProductName($('title').first().text(), platform);
  if (!productName) productName = cleanProductName($('h1').first().text(), platform);

  const keywords = [];

  const metaKw = $('meta[name="keywords"]').attr('content');
  if (metaKw) {
    metaKw.split(/[,;]/).forEach(k => {
      const t = k.trim();
      if (!isNavJunk(t) && t.length > 2 && t.length < 60) keywords.push(t);
    });
  }

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text() || $(el).html() || '';
      if (!raw.trim()) return;
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : [data];
      const collect = val => {
        if (!val) return;
        if (Array.isArray(val)) val.forEach(collect);
        else if (typeof val === 'string') {
          val.split(/[,;]/).forEach(t => {
            const s = t.trim();
            if (!isNavJunk(s) && s.length > 2 && s.length < 60) keywords.push(s);
          });
        }
      };
      items.forEach(item => {
        if (!item || typeof item !== 'object') return;
        collect(item.keywords);
        collect(item.applicationCategory);
        collect(item.applicationSubCategory);
        collect(item.category);
        collect(item.genre);
      });
    } catch (_) {}
  });

  // Platform-specific selectors (best effort — usually JS-rendered)
  const sels =
    platform === 'capterra'
      ? ['span.sb.badge span', 'span[class*="badge"] span', 'span[class*="rx-text-xs"]']
      : (platform === 'g2' || platform === 'g2service')
      ? [
          'div.elv-flex.elv-items-center.elv-gap-2 span.elv-text-sm.elv-text-subtle',
          'span.elv-text-subtle',
          'span[class*="subtle"]',
        ]
      : ['[class*="category"]', '[class*="topic"]', '[class*="tag"]', '[class*="label"]'];

  sels.forEach(sel => {
    $(sel).each((_, el) => {
      const t = $(el).text().trim();
      if (!isNavJunk(t) && t.length > 2 && t.length < 60 && !t.includes('\n')) keywords.push(t);
    });
  });

  return { productName, keywords: dedupeKeywords(keywords).slice(0, 12) };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * scrapeUrl(url, platform)
 * Returns: { productName, keywords, usedFallbackKeywords }
 *
 * `usedFallbackKeywords: true` means we couldn't extract real product topics
 * from the page (Capterra/G2 are usually Cloudflare-blocked) and the keywords
 * are the platform's generic review-form criteria. The client should call
 * /api/generate-keywords to upgrade these to product-specific topics using AI.
 */
async function scrapeUrl(url, platform = 'capterra') {
  const norm = (platform || 'capterra').toLowerCase();

  // Strategy 0: extract product name from URL — robust to all known shapes
  const urlName = extractNameFromUrl(url, norm);

  // Track the best name scraped from page content across all strategies, so
  // we don't lose it when one strategy yields a great name but few keywords.
  // The scraped name is canonical; the URL name is heuristic and may be junk
  // (e.g. "" for /products/new/<UUID>/ review-submission URLs).
  let bestScrapedName = '';
  const isDifferentFromUrl = n =>
    n && (!urlName || n.toLowerCase() !== urlName.toLowerCase());

  // Strategy 1: Jina Reader (works for SoftwareReviews; blocked on Capterra/G2)
  try {
    const md = await fetchViaJina(url);
    if (md) {
      const { productName, keywords } = parseJinaMarkdown(md, norm, urlName);
      if (isDifferentFromUrl(productName)) bestScrapedName = productName;
      if (keywords.length >= 3) {
        return {
          productName: bestScrapedName || productName || urlName || '',
          keywords,
          usedFallbackKeywords: false,
        };
      }
    }
  } catch (err) {
    console.error('[scrape] Jina failed:', err.message);
  }

  // Strategy 2: Direct fetch + cheerio
  try {
    const html = await fetchDirect(url);
    if (html) {
      const { productName, keywords } = parseHtml(html, norm, urlName);
      if (!bestScrapedName && isDifferentFromUrl(productName)) {
        bestScrapedName = productName;
      }
      if (keywords.length >= 3) {
        return {
          productName: bestScrapedName || productName || urlName || '',
          keywords,
          usedFallbackKeywords: false,
        };
      }
    }
  } catch (err) {
    console.error('[scrape] direct fetch failed:', err.message);
  }

  // Strategy 3: Guaranteed fallback — best name we have + platform-standard topics.
  // Caller should upgrade keywords via /api/generate-keywords.
  const defaultKeywords = PLATFORM_DEFAULT_KEYWORDS[norm] || PLATFORM_DEFAULT_KEYWORDS.capterra;
  return {
    productName: bestScrapedName || urlName || '',
    keywords: defaultKeywords,
    usedFallbackKeywords: true,
  };
}

module.exports = {
  scrapeUrl,
  scrapeCapterraUrl: url => scrapeUrl(url, 'capterra'),
  scrapeG2Url: url => scrapeUrl(url, 'g2'),
  scrapeG2ServiceUrl: url => scrapeUrl(url, 'g2service'),
  scrapeSoftwareReviewsUrl: url => scrapeUrl(url, 'softwarereviews'),
  // exported for unit testing
  extractNameFromUrl,
  slugToTitle,
};
