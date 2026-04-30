import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import './App.css'

const API = ''

// ─── Platform config ───────────────────────────────────────────────────────────
const PLATFORMS = [
  { id: 'capterra',         label: 'Capterra' },
  { id: 'g2',               label: 'G2 (Software)' },
  { id: 'g2service',        label: 'G2 (Service)' },
  { id: 'softwarereviews',  label: 'Software Reviews' },
]

const PLATFORM_SECTIONS = {
  capterra: [
    { key: 'title',   label: 'Title',   color: 'accent' },
    { key: 'pros',    label: 'Pros',    color: 'green' },
    { key: 'cons',    label: 'Cons',    color: 'red' },
    { key: 'overall', label: 'Overall', color: 'purple' },
  ],
  g2: [
    { key: 'title',           label: 'Title',                              color: 'accent' },
    { key: 'pros',            label: 'What You Like Best',                 color: 'green' },
    { key: 'cons',            label: 'What You Dislike',                   color: 'red' },
    { key: 'problemsSolving', label: "Problems It's Solving & Benefiting", color: 'teal' },
  ],
  // NEW: G2 (Service) — agencies/consultancies/providers
  g2service: [
    { key: 'title',           label: 'Title',                              color: 'accent' },
    { key: 'problemsSolving', label: 'Problems Solving & Benefits',        color: 'teal' },
    { key: 'whatYouLikeBest', label: 'What You Like Best',                 color: 'green' },
    { key: 'dislikes',        label: 'What You Dislike',                   color: 'red' },
    { key: 'recommendations', label: 'Recommendations to Others',          color: 'purple' },
  ],
  softwarereviews: [
    { key: 'title',              label: 'Title',                              color: 'accent' },
    { key: 'pros',               label: 'Pros',                               color: 'green' },
    { key: 'cons',               label: 'Cons',                               color: 'red' },
    { key: 'additionalFeature',  label: "Additional Feature I'd Like to See", color: 'yellow' },
    { key: 'whatMakesDifferent', label: 'What Makes It Different',            color: 'teal' },
    { key: 'suggestion',         label: 'Suggestion',                         color: 'muted' },
  ],
}

// ─── Empty product row factory ─────────────────────────────────────────────────
const makeProduct = () => ({
  id: Date.now() + Math.random(),
  platform: 'capterra',
  url: '',
  manualInput: '',    // "Software Name: keyword1, keyword2"
  productName: '',
  keywords: [],
  scraping: false,
  scrapeError: '',
  scraped: false,
})

// ─── Clipboard with 2s feedback ────────────────────────────────────────────────
function useCopy() {
  const [copiedKey, setCopiedKey] = useState(null)
  const copy = useCallback((key, text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    }).catch(() => {
      // fallback for non-secure contexts
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    })
  }, [])
  return { copiedKey, copy }
}

// ─── Provider config (mirrored from server) ──────────────────────────────────
// Key/model are per-provider so switching back and forth keeps both intact.
const PROVIDER_DEFAULTS = {
  openrouter: { keyStorage: 'or_api_key',     modelStorage: 'or_model',     customStorage: 'or_custom_model',     defaultModel: 'anthropic/claude-opus-4', label: 'OpenRouter', keysUrl: 'https://openrouter.ai/keys',     keyPlaceholder: 'sk-or-v1-...' },
  cometapi:   { keyStorage: 'cometapi_key',   modelStorage: 'cometapi_model', customStorage: 'cometapi_custom_model', defaultModel: 'gpt-4o',                  label: 'CometAPI',   keysUrl: 'https://www.cometapi.com/console/token', keyPlaceholder: 'sk-...' },
}

// ─── Topic-cache helpers (localStorage, provider-agnostic) ───────────────────
// Same product on the same platform is always the same product — caching its
// AI-generated topics means the AI is called ONCE per product, ever (per
// browser). Clearing the cache forces a refresh.
const KW_CACHE_KEY = 'kw_cache_v1'
const readKwCache = () => {
  try { return JSON.parse(localStorage.getItem(KW_CACHE_KEY) || '{}') } catch { return {} }
}
const writeKwCache = obj => { try { localStorage.setItem(KW_CACHE_KEY, JSON.stringify(obj)) } catch {} }
const kwCacheKey = (platform, name) =>
  `${(platform || 'capterra').toLowerCase()}::${(name || '').toLowerCase().trim()}`
const getCachedKeywords = (platform, name) => {
  if (!name) return null
  const v = readKwCache()[kwCacheKey(platform, name)]
  return Array.isArray(v) && v.length >= 3 ? v : null
}
const cacheKeywords = (platform, name, kws) => {
  if (!name || !Array.isArray(kws) || kws.length < 3) return
  const c = readKwCache()
  c[kwCacheKey(platform, name)] = kws
  writeKwCache(c)
}
const clearKwCache = () => { try { localStorage.removeItem(KW_CACHE_KEY) } catch {} }

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  // Settings — provider + per-provider keys/models (so switching is non-destructive)
  const [provider, setProvider] = useState(() => localStorage.getItem('llm_provider') || 'openrouter')
  const [orKey, setOrKey]               = useState(() => localStorage.getItem('or_api_key') || '')
  const [cometKey, setCometKey]         = useState(() => localStorage.getItem('cometapi_key') || '')
  const [orModel, setOrModel]           = useState(() => localStorage.getItem('or_model') || PROVIDER_DEFAULTS.openrouter.defaultModel)
  const [cometModel, setCometModel]     = useState(() => localStorage.getItem('cometapi_model') || PROVIDER_DEFAULTS.cometapi.defaultModel)
  const [orCustomModel, setOrCustomModel]       = useState(() => localStorage.getItem('or_custom_model') || '')
  const [cometCustomModel, setCometCustomModel] = useState(() => localStorage.getItem('cometapi_custom_model') || '')
  const customModelDebounceRef = useRef(null)
  const [models, setModels] = useState([])
  const [showSettings, setShowSettings] = useState(false)
  const [cacheCleared, setCacheCleared] = useState(false)

  // Active values for the currently-selected provider — the rest of the app reads these.
  const apiKey      = provider === 'cometapi' ? cometKey      : orKey
  const setApiKey   = provider === 'cometapi' ? setCometKey   : setOrKey
  const model       = provider === 'cometapi' ? cometModel    : orModel
  const setModel    = provider === 'cometapi' ? setCometModel : setOrModel
  const customModel = provider === 'cometapi' ? cometCustomModel    : orCustomModel
  const setCustomModelState = provider === 'cometapi' ? setCometCustomModel : setOrCustomModel
  const providerCfg = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openrouter

  // Profile input
  const [inputMode, setInputMode] = useState('paste')
  const [pastedLine, setPastedLine] = useState('')
  const [parsedProfile, setParsedProfile] = useState(null)
  const [xlsxProfiles, setXlsxProfiles] = useState([])
  const [selectedRow, setSelectedRow] = useState(null)
  const [xlsxFileName, setXlsxFileName] = useState('')

  // Product rows (batch) — start with exactly ONE empty row
  const [products, setProducts] = useState([makeProduct()])

  // Results
  const [batchResults, setBatchResults] = useState([]) // [{productName, platform, review, error}]
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')

  const { copiedKey, copy } = useCopy()

  // Load models for current provider (refetched when user switches provider).
  useEffect(() => {
    axios.get(`${API}/api/models?provider=${provider}`).then(r => setModels(r.data)).catch(() => setModels([]))
  }, [provider])

  // Persist settings — each provider's values are kept independently.
  useEffect(() => { localStorage.setItem('llm_provider', provider) }, [provider])
  useEffect(() => { if (orKey)     localStorage.setItem('or_api_key', orKey) },         [orKey])
  useEffect(() => { if (cometKey)  localStorage.setItem('cometapi_key', cometKey) },    [cometKey])
  useEffect(() => { if (orModel)    localStorage.setItem('or_model', orModel) },        [orModel])
  useEffect(() => { if (cometModel) localStorage.setItem('cometapi_model', cometModel) }, [cometModel])

  // Auto-save custom model with 500ms debounce — writes to the active provider's key.
  const handleCustomModelChange = (val) => {
    setCustomModelState(val)
    if (customModelDebounceRef.current) clearTimeout(customModelDebounceRef.current)
    const storageKey = providerCfg.customStorage
    customModelDebounceRef.current = setTimeout(() => {
      const trimmed = val.trim()
      if (trimmed) localStorage.setItem(storageKey, trimmed)
    }, 500)
  }

  const handleCustomModelBlur = () => {
    if (customModelDebounceRef.current) clearTimeout(customModelDebounceRef.current)
    const trimmed = customModel.trim()
    if (trimmed) localStorage.setItem(providerCfg.customStorage, trimmed)
  }

  const activeModel = model === '__custom__' ? customModel.trim() : model

  const handleClearCache = () => {
    clearKwCache()
    setCacheCleared(true)
    setTimeout(() => setCacheCleared(false), 1800)
  }

  // ── Profile parse ──────────────────────────────────────────────────────────
  const handleParseLine = async () => {
    if (!pastedLine.trim()) return
    try {
      const r = await axios.post(`${API}/api/parse-line`, { line: pastedLine })
      setParsedProfile(r.data.profile)
    } catch (e) { console.error(e) }
  }

  const handleXlsxUpload = async e => {
    const file = e.target.files[0]
    if (!file) return
    setXlsxFileName(file.name)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await axios.post(`${API}/api/parse-xlsx`, fd)
      setXlsxProfiles(r.data.profiles)
      setSelectedRow(null)
    } catch (err) {
      alert('Failed to parse XLSX: ' + (err.response?.data?.error || err.message))
    }
  }

  const activeProfile = inputMode === 'paste'
    ? parsedProfile
    : (selectedRow !== null ? xlsxProfiles[selectedRow] : null)

  // ── Product rows helpers ───────────────────────────────────────────────────
  const updateProduct = (id, patch) =>
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))

  const addProductRow = () => setProducts(prev => [...prev, makeProduct()])

  const removeProductRow = id =>
    setProducts(prev => prev.length > 1 ? prev.filter(p => p.id !== id) : prev)

  // Upgrade generic platform fallback keywords into product-specific topics.
  // Order:
  //   1. Try the local cache — same product = same topics, zero API cost.
  //   2. If miss, call the user's selected provider (OpenRouter or CometAPI),
  //      then cache the result so next time is free.
  // No-op if we have neither cache nor key/model.
  const upgradeKeywordsWithAI = async (id, productName, platform) => {
    if (!productName) return

    const cached = getCachedKeywords(platform, productName)
    if (cached) {
      updateProduct(id, { keywords: cached, keywordsUpgrading: false, keywordsFromCache: true })
      return
    }

    if (!apiKey || !activeModel) return
    updateProduct(id, { keywordsUpgrading: true, keywordsFromCache: false })
    try {
      const r = await axios.post(`${API}/api/generate-keywords`, {
        apiKey,
        model: activeModel,
        productName,
        platform,
        provider,
      })
      if (Array.isArray(r.data?.keywords) && r.data.keywords.length >= 3) {
        cacheKeywords(platform, productName, r.data.keywords)
        updateProduct(id, { keywords: r.data.keywords, keywordsUpgrading: false })
        return
      }
    } catch (_) { /* keep the fallback keywords on failure */ }
    updateProduct(id, { keywordsUpgrading: false })
  }

  // Scrape a single product row
  const handleScrapeRow = async (id) => {
    const row = products.find(p => p.id === id)
    if (!(row?.url || '').trim()) return
    updateProduct(id, { scraping: true, scrapeError: '', productName: '', keywords: [], scraped: false })
    try {
      const r = await axios.post(`${API}/api/scrape`, { url: row.url.trim(), platform: row.platform })
      updateProduct(id, {
        productName: r.data.productName,
        keywords: r.data.keywords,
        scraping: false,
        scraped: true,
        scrapeError: '',
      })
      if (r.data.usedFallbackKeywords && r.data.productName) {
        upgradeKeywordsWithAI(id, r.data.productName, row.platform)
      }
    } catch (err) {
      updateProduct(id, {
        scraping: false,
        scrapeError: err.response?.data?.error || 'Scrape failed',
      })
    }
  }

  // Batch scrape all rows with URLs
  const handleBatchScrape = async () => {
    const toScrape = products.filter(p => (p.url || '').trim())
    if (!toScrape.length) return

    // Mark all as scraping
    toScrape.forEach(p => updateProduct(p.id, { scraping: true, scrapeError: '', scraped: false }))

    const items = toScrape.map((p, i) => ({ url: p.url, index: i, id: p.id, platform: p.platform }))

    // Group by platform and fire per-platform batch requests, or just hit individually in parallel
    await Promise.allSettled(
      items.map(async item => {
        try {
          const r = await axios.post(`${API}/api/scrape`, { url: item.url.trim(), platform: item.platform })
          updateProduct(item.id, {
            productName: r.data.productName,
            keywords: r.data.keywords,
            scraping: false,
            scraped: true,
            scrapeError: '',
          })
          if (r.data.usedFallbackKeywords && r.data.productName) {
            upgradeKeywordsWithAI(item.id, r.data.productName, item.platform)
          }
        } catch (err) {
          updateProduct(item.id, {
            scraping: false,
            scrapeError: err.response?.data?.error || 'Scrape failed',
          })
        }
      })
    )
  }

  // ── Generate all ──────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!apiKey) { setGenError(`Enter your ${providerCfg.label} API key in Settings`); return }
    if (!activeModel) { setGenError('Enter a model ID in Settings'); return }
    if (!activeProfile) { setGenError('Select or parse a profile first'); return }

    // Resolve each product row into { productName, keywords, platform }
    const resolved = products.map(p => {
      const pName = (p.productName || '').trim()
      const pManual = (p.manualInput || '').trim()
      if (pName) {
        return { productName: pName, keywords: Array.isArray(p.keywords) ? p.keywords : [], platform: p.platform }
      }
      // Manual input: "Software Name: keyword1, keyword2"
      if (pManual) {
        const [namePart, kwPart] = pManual.split(':')
        return {
          productName: (namePart || '').trim(),
          keywords: kwPart ? kwPart.split(',').map(k => (k || '').trim()).filter(Boolean) : [],
          platform: p.platform,
        }
      }
      return null
    }).filter(Boolean)

    if (!resolved.length) { setGenError('Add at least one product with a name or manual input'); return }

    setGenerating(true)
    setGenError('')
    setBatchResults([])

    try {
      const r = await axios.post(`${API}/api/generate-batch`, {
        apiKey,
        model: activeModel,
        profile: activeProfile,
        products: resolved,
        provider,
      })
      setBatchResults(r.data)
    } catch (err) {
      setGenError(err.response?.data?.error || 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  // ── Export to .txt ──────────────────────────────────────────────────────────
  const handleExport = () => {
    if (!batchResults.length) return
    const lines = batchResults.map((result, i) => {
      if (result.error) return `[${i + 1}] ${result.productName} — ERROR: ${result.error}`
      const platform = result.platform?.toUpperCase() || 'CAPTERRA'
      const sections = PLATFORM_SECTIONS[result.platform] || PLATFORM_SECTIONS.capterra
      const body = sections
        .map(s => result.review[s.key] ? `${s.label}:\n${result.review[s.key]}` : '')
        .filter(Boolean)
        .join('\n\n')
      return `${'='.repeat(60)}\n[${i + 1}] ${result.productName} — ${platform}\n${'='.repeat(60)}\n\n${body}`
    })
    const content = lines.join('\n\n\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reviews_${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-dot" />
            <span>ReviewGen</span>
          </div>
          <div className="header-right">
            {apiKey && <span className="api-badge"><span className="dot green" /> {providerCfg.label} Connected</span>}
            <button className="btn-ghost" onClick={() => setShowSettings(!showSettings)}>⚙ Settings</button>
          </div>
        </div>
      </header>

      {/* Settings */}
      {showSettings && (
        <div className="settings-panel">
          <div className="settings-inner">
            <h3>Settings</h3>

            {/* Provider toggle */}
            <div className="field-group" style={{ marginBottom: 16 }}>
              <label>AI Provider</label>
              <div className="tab-toggle" style={{ display: 'inline-flex' }}>
                <button
                  type="button"
                  className={provider === 'openrouter' ? 'tab active' : 'tab'}
                  onClick={() => setProvider('openrouter')}
                >OpenRouter</button>
                <button
                  type="button"
                  className={provider === 'cometapi' ? 'tab active' : 'tab'}
                  onClick={() => setProvider('cometapi')}
                >CometAPI</button>
              </div>
              <span className="hint">Switch between providers anytime — both API keys are kept saved.</span>
            </div>

            <div className="settings-row">
              <div className="field-group">
                <label>{providerCfg.label} API Key</label>
                <input
                  type="password" className="input mono"
                  placeholder={providerCfg.keyPlaceholder}
                  value={apiKey} onChange={e => setApiKey(e.target.value)}
                />
                <span className="hint">Get yours at <a href={providerCfg.keysUrl} target="_blank" rel="noreferrer">{providerCfg.keysUrl.replace(/^https?:\/\//, '')}</a></span>
              </div>
              <div className="field-group">
                <label>AI Model</label>
                <select className="input" value={model} onChange={e => setModel(e.target.value)}>
                  {models.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.badge ? `[${m.badge}] ` : ''}{m.name}
                    </option>
                  ))}
                  <option value="__custom__">✏ Custom model ID...</option>
                </select>
                {model === '__custom__' && (
                  <input
                    className="input mono"
                    placeholder={provider === 'cometapi' ? 'e.g. gpt-4o-mini, deepseek-v3.1, gemini-2.5-flash' : 'e.g. google/gemini-2.5-flash or anthropic/claude-haiku-4'}
                    value={customModel}
                    onChange={e => handleCustomModelChange(e.target.value)}
                    onBlur={handleCustomModelBlur}
                  />
                )}
                <span className="hint">Custom accepts any {providerCfg.label} model ID — auto-saved on blur.</span>
              </div>
            </div>

            {/* Topic cache controls */}
            <div className="field-group" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #2a2a2a' }}>
              <label>Topic cache</label>
              <span className="hint">
                Each product's AI-generated topics are cached locally so the same product never burns credits twice. Switching providers also reuses the cache.
              </span>
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn-secondary sm" onClick={handleClearCache}>
                  {cacheCleared ? 'Cleared ✓' : 'Clear topic cache'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="main">
        <div className="two-col">
          {/* ── LEFT panel ── */}
          <div className="panel left-panel">

            {/* Step 1: Profile */}
            <div className="panel-header">
              <h2>1. Profile Input</h2>
              <div className="tab-toggle">
                <button className={inputMode === 'paste' ? 'tab active' : 'tab'} onClick={() => setInputMode('paste')}>Paste Line</button>
                <button className={inputMode === 'xlsx' ? 'tab active' : 'tab'} onClick={() => setInputMode('xlsx')}>Upload XLSX</button>
              </div>
            </div>

            {inputMode === 'paste' ? (
              <div className="section">
                <label className="label">Paste the row line</label>
                <textarea
                  className="textarea mono" rows={3}
                  placeholder={"email\tName\tPosition\tCompany\tSize\tIndustry\tJobFunction"}
                  value={pastedLine}
                  onChange={e => setPastedLine(e.target.value)}
                  onBlur={handleParseLine}
                />
                <button className="btn-secondary sm" onClick={handleParseLine}>Parse Line</button>
                {parsedProfile && (
                  <div className="profile-card">
                    <ProfileDisplay profile={parsedProfile} onCopy={copy} copiedKey={copiedKey} />
                  </div>
                )}
              </div>
            ) : (
              <div className="section">
                <label className="label">Upload XLSX</label>
                <div className="upload-zone">
                  <input type="file" accept=".xlsx,.xls" onChange={handleXlsxUpload} id="xlsx-input" style={{ display: 'none' }} />
                  <label htmlFor="xlsx-input" className="upload-label">{xlsxFileName || '+ Click to upload XLSX'}</label>
                </div>
                {xlsxProfiles.length > 0 && (
                  <div className="row-list">
                    <label className="label">{xlsxProfiles.length} profiles — select one</label>
                    <div className="scroll-list">
                      {xlsxProfiles.map((p, i) => (
                        <button
                          key={i}
                          className={`row-item ${selectedRow === i ? 'selected' : ''}`}
                          onClick={() => setSelectedRow(i)}
                        >
                          <span className="row-num">#{p.rowNumber}</span>
                          <span className="row-name">{p.name || p.email}</span>
                          <span className="row-role">{p.position} · {p.company}</span>
                        </button>
                      ))}
                    </div>
                    {selectedRow !== null && (
                      <div className="profile-card">
                        <ProfileDisplay profile={xlsxProfiles[selectedRow]} onCopy={copy} copiedKey={copiedKey} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Products (batch) */}
            <div className="divider" />
            <div className="step2-header">
              <h2>2. Products</h2>
              <button className="btn-ghost sm" onClick={handleBatchScrape} title="Scrape all rows with URLs at once">
                ⚡ Scrape All
              </button>
            </div>

            <div className="products-list">
              {products.map((prod, idx) => (
                <ProductRow
                  key={prod.id}
                  prod={prod}
                  idx={idx}
                  onUpdate={patch => updateProduct(prod.id, patch)}
                  onScrape={() => handleScrapeRow(prod.id)}
                  onRemove={() => removeProductRow(prod.id)}
                  showRemove={products.length > 1}
                />
              ))}
            </div>

            <button className="btn-secondary add-row-btn" onClick={addProductRow}>+ Add Product Row</button>

            {/* Generate */}
            <div className="divider" />
            <button
              className="btn-primary generate-btn"
              onClick={handleGenerate}
              disabled={generating || !activeProfile}
            >
              {generating
                ? <span className="generating-text"><span className="spinner" /> Generating {products.filter(p => p.productName || p.manualInput).length || products.length} review(s)...</span>
                : `→ Generate ${products.length} Review(s)`}
            </button>
            {genError && <p className="error-text">{genError}</p>}
          </div>

          {/* ── RIGHT panel ── */}
          <div className="panel output-panel">
            <div className="panel-header">
              <h2>Review Output</h2>
              {batchResults.length > 0 && (
                <div className="output-actions">
                  <button className="btn-ghost sm" onClick={() => {
                    const all = batchResults.map(r => {
                      if (r.error) return `${r.productName}: ERROR`
                      const sections = PLATFORM_SECTIONS[r.platform] || PLATFORM_SECTIONS.capterra
                      return sections.map(s => r.review[s.key] ? `${s.label}: ${r.review[s.key]}` : '').filter(Boolean).join('\n\n')
                    }).join('\n\n' + '─'.repeat(40) + '\n\n')
                    copy('all', all)
                  }}>
                    {copiedKey === 'all' ? '✓ Copied' : 'Copy All'}
                  </button>
                  <button className="btn-export" onClick={handleExport}>↓ Export .txt</button>
                </div>
              )}
            </div>

            {!batchResults.length && !generating && (
              <div className="empty-state">
                <div className="empty-icon">✦</div>
                <p>Fill in profile + products,<br />then hit Generate.</p>
                <p className="hint-sm">Each section is click-to-copy.</p>
              </div>
            )}

            {generating && (
              <div className="empty-state">
                <div className="pulse-ring" />
                <p>AI is writing your reviews...</p>
              </div>
            )}

            {batchResults.length > 0 && (
              <div className="batch-results">
                {batchResults.map((result, i) => (
                  <BatchResultBlock
                    key={i}
                    result={result}
                    idx={i}
                    copiedKey={copiedKey}
                    onCopy={copy}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

// ─── Product Row ───────────────────────────────────────────────────────────────
function ProductRow({ prod, idx, onUpdate, onScrape, onRemove, showRemove }) {
  const hasUrl = (prod.url || '').trim().length > 0

  return (
    <div className="product-row">
      <div className="product-row-header">
        <span className="product-row-num">Product {idx + 1}</span>
        <div className="product-row-controls">
          <select
            className="input select-sm"
            value={prod.platform}
            onChange={e => onUpdate({ platform: e.target.value, productName: '', keywords: [], scraped: false, scrapeError: '' })}
          >
            {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {showRemove && (
            <button className="btn-remove" onClick={onRemove} title="Remove row">×</button>
          )}
        </div>
      </div>

      {/* URL field */}
      <div className="url-row">
        <input
          className="input flex1"
          placeholder={`Paste ${PLATFORMS.find(p => p.id === prod.platform)?.label || ''} review URL...`}
          value={prod.url}
          onChange={e => onUpdate({ url: e.target.value, productName: '', keywords: [], scraped: false, scrapeError: '' })}
          onKeyDown={e => e.key === 'Enter' && onScrape()}
        />
        <button
          className="btn-secondary"
          onClick={onScrape}
          disabled={prod.scraping || !(prod.url || '').trim()}
        >
          {prod.scraping ? '...' : 'Scrape'}
        </button>
      </div>

      {prod.scrapeError && <p className="error-text sm">{prod.scrapeError}</p>}

      {/* Scraped result */}
      {prod.scraped && prod.productName && (
        <div className="scraped-result">
          <div className="product-name-row">
            <span className="tag green">Product</span>
            <input
              className="input product-input"
              value={prod.productName}
              onChange={e => onUpdate({ productName: e.target.value })}
            />
          </div>
          {prod.keywords.length > 0 && (
            <div className="keywords-row">
              <span className="tag accent">
                Topics
                {prod.keywordsUpgrading && <span className="hint" style={{ marginLeft: 6 }}>(refining with AI…)</span>}
              </span>
              <div className="keyword-chips">
                {prod.keywords.map((k, i) => <span key={i} className="chip">{k}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual input — only shown when URL field is empty */}
      {!hasUrl && (
        <div className="manual-override">
          <input
            className="input"
            placeholder="Software Name: keyword1, keyword2, keyword3"
            value={prod.manualInput}
            onChange={e => onUpdate({ manualInput: e.target.value })}
          />
          <span className="field-hint">Format: "Product Name: topic1, topic2"</span>
        </div>
      )}
    </div>
  )
}

// ─── Profile Display (clickable fields) ───────────────────────────────────────
function ProfileDisplay({ profile, onCopy, copiedKey }) {
  const fields = [
    { key: 'name', label: 'Name', value: profile.name },
    { key: 'position', label: 'Position', value: profile.position },
    { key: 'company', label: 'Company', value: profile.company },
    { key: 'size', label: 'Size', value: profile.companySize },
    { key: 'industry', label: 'Industry', value: profile.industry },
    { key: 'fn', label: 'Function', value: profile.jobFunction },
  ].filter(f => f.value)

  return (
    <div className="profile-fields">
      {fields.map(f => (
        <div
          key={f.key}
          className={`profile-field copyable ${copiedKey === ('pf_' + f.key) ? 'copied' : ''}`}
          onClick={() => onCopy('pf_' + f.key, f.value)}
          title="Click to copy"
        >
          <span className="pf-label">{f.label}</span>
          <span className="pf-value">{f.value}</span>
          <span className="pf-copy-hint">
            {copiedKey === ('pf_' + f.key) ? '✓' : '⎘'}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Single batch result block ─────────────────────────────────────────────────
function BatchResultBlock({ result, idx, copiedKey, onCopy }) {
  const [collapsed, setCollapsed] = useState(false)
  const sections = PLATFORM_SECTIONS[result.platform] || PLATFORM_SECTIONS.capterra

  if (result.error) {
    return (
      <div className="result-block error-block">
        <div className="result-block-header">
          <span className="result-title">{idx + 1}. {result.productName}</span>
          <span className="platform-badge error">ERROR</span>
        </div>
        <p className="error-text sm">{result.error}</p>
      </div>
    )
  }

  return (
    <div className="result-block">
      <div className="result-block-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="result-title">{idx + 1}. {result.productName}</span>
        <div className="result-header-right">
          <span className={`platform-badge plat-${result.platform}`}>
            {PLATFORMS.find(p => p.id === result.platform)?.label || result.platform}
          </span>
          <button
            className="btn-ghost xs"
            onClick={e => {
              e.stopPropagation()
              const all = sections.map(s => result.review[s.key] || '').filter(Boolean).join('\n\n')
              onCopy(`block_all_${idx}`, all)
            }}
          >
            {copiedKey === `block_all_${idx}` ? '✓' : 'Copy All'}
          </button>
          <span className="collapse-icon">{collapsed ? '▸' : '▾'}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="review-sections">
          {sections.map(s => (
            result.review[s.key] ? (
              <ReviewSection
                key={s.key}
                sectionKey={`${idx}_${s.key}`}
                label={s.label}
                value={result.review[s.key]}
                color={s.color}
                copied={copiedKey === `${idx}_${s.key}`}
                onCopy={() => onCopy(`${idx}_${s.key}`, result.review[s.key])}
              />
            ) : null
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Review Section ────────────────────────────────────────────────────────────
function ReviewSection({ sectionKey, label, value, color, copied, onCopy }) {
  return (
    <div
      className={`review-section color-${color} ${copied ? 'copied' : ''}`}
      onClick={onCopy}
    >
      <div className="rs-header">
        <span className={`rs-label color-${color}`}>{label}</span>
        <span className="rs-copy-hint">{copied ? '✓ Copied' : 'Click to copy'}</span>
      </div>
      <p className="rs-value">{value}</p>
    </div>
  )
}
