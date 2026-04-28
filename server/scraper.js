const axios = require('axios');
const cheerio = require('cheerio');

// Multi-strategy scraper (no headless browser).
//
// Product name: always resolved from the URL (Strategy 0), which is 100% reliable
//   for Capterra, G2, and SoftwareReviews — even when the page itself is blocked.
//
// Keywords: best-effort via three strategies:
//   1. Jina Reader proxy (r.jina.ai) — free, handles JS. Works for SoftwareReviews.
//      Blocked by Cloudflare on Capterra / G2.
//   2. Direct HTTP + cheerio — meta tags, JSON-LD, platform selectors.
//      Also blocked on Capterra / G2.
//   3. Platform-standard review topics — the actual rating dimensions each platform
//      shows in its review form ("Consider covering…"). These are the same topics a
//      real Capterra/G2 review covers, so they guide the AI just as well as scraped
//      page keywords would.
//
// AI review generation is unaffected in every case — the prompt already has sensible
// defaults when keywords are empty, but these platform-standard topics are much richer.

// ─── Platform-standard review topics ─────────────────────────────────────────
// These match the actual criteria/prompts each platform uses in its review form.

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

// ─── Strategy 0: URL-based product name ──────────────────────────────────────

/**
 * Extract the product name directly from the URL path.
 * Works 100% of the time for well-formed Capterra, G2, and SoftwareReviews links.
 */
function extractNameFromUrl(rawUrl, platform) {
  try {
    const u = new URL(rawUrl);
    const parts = u.pathname.split('/').filter(Boolean);

    let slug = '';

    if (platform === 'capterra') {
      // /p/ID/Product-Name[/...]  or  /software/ID/Product-Name[/...]
      // slug is always the 3rd segment (index 2)
      slug = parts[2] || '';
    } else if (platform === 'g2') {
      // /products/product-slug/reviews[/...]
      const idx = parts.indexOf('products');
      if (idx !== -1 && parts[idx + 1]) slug = parts[idx + 1];
    } else if (platform === 'softwarereviews' || platform === 'software_reviews') {
      // /products/product-slug[/reviews/...]  or just /product-slug at last segment
      const idx = parts.indexOf('products');
      if (idx !== -1 && parts[idx + 1]) slug = parts[idx + 1];
      else slug = parts[parts.length - 1] || '';
    }

    if (!slug) return '';

    // Convert "microsoft-teams" → "Microsoft Teams"
    // Handle edge cases like "monday.com" (preserve lowercase brand)
    const hasDotCom = /\.\w+$/.test(slug);
    if (hasDotCom) {
      // Preserve as-is for domains like "monday.com"
      return slug.replace(/-/g, ' ');
    }
    return slug
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .trim();
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
  if (platform === 'g2') name = name.replace(/\s*\|?\s*G2\s*$/i, '').trim();
  if (platform === 'capterra') name = name.replace(/\s*\|?\s*Capterra\s*$/i, '').trim();
  if (platform === 'softwarereviews' || platform === 'software_reviews') {
    name = name.replace(/\s*\|?\s*SoftwareReviews\s*$/i, '').trim();
  }

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
  // Reject items that are navigation/footer links, not real topics
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

function parseJinaMarkdown(md, platform, knownName) {
  let productName = knownName || '';

  if (!productName) {
    const titleLine = md.match(/^Title:\s*(.+)$/m);
    if (titleLine) productName = cleanProductName(titleLine[1], platform);
  }
  if (!productName) {
    const h1 = md.match(/^#\s+(.+)$/m);
    if (h1) productName = cleanProductName(h1[1], platform);
  }

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
      : platform === 'g2'
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

async function scrapeUrl(url, platform = 'capterra') {
  const norm = (platform || 'capterra').toLowerCase();

  // Strategy 0: extract product name from URL — always reliable
  const urlName = extractNameFromUrl(url, norm);

  // Strategy 1: Jina Reader (works for SoftwareReviews; blocked on Capterra/G2)
  try {
    const md = await fetchViaJina(url);
    if (md) {
      const { productName, keywords } = parseJinaMarkdown(md, norm, urlName);
      // If we got real scraped keywords, return them
      if (keywords.length >= 3) {
        return { productName: productName || urlName || 'Unknown Product', keywords };
      }
      // Even with no keywords, we have a name — continue to try next strategy for keywords
    }
  } catch (err) {
    console.error('[scrape] Jina failed:', err.message);
  }

  // Strategy 2: Direct fetch + cheerio
  try {
    const html = await fetchDirect(url);
    if (html) {
      const { productName, keywords } = parseHtml(html, norm, urlName);
      if (keywords.length >= 3) {
        return { productName: productName || urlName || 'Unknown Product', keywords };
      }
    }
  } catch (err) {
    console.error('[scrape] direct fetch failed:', err.message);
  }

  // Strategy 3: Guaranteed fallback — name from URL + platform-standard review topics.
  // These match the actual criteria Capterra/G2/SoftwareReviews use in their review forms.
  const defaultKeywords = PLATFORM_DEFAULT_KEYWORDS[norm] || PLATFORM_DEFAULT_KEYWORDS.capterra;
  return {
    productName: urlName || 'Unknown Product',
    keywords: defaultKeywords,
  };
}

module.exports = {
  scrapeUrl,
  scrapeCapterraUrl: url => scrapeUrl(url, 'capterra'),
  scrapeG2Url: url => scrapeUrl(url, 'g2'),
  scrapeSoftwareReviewsUrl: url => scrapeUrl(url, 'softwarereviews'),
};
