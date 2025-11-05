/*
  script.js

  Simple chat client that posts a `messages` array to a Cloudflare Worker.
  The Worker should forward the request to OpenAI using a stored secret.

  Important:
  - Put your deployed worker URL in `secrets.js` (WORKER_URL).
  - For local testing only, you may set OPENAI_API_KEY in `secrets.js` and the
    fallback code will call OpenAI directly (not recommended for production).
*/

/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");

// Allow a local override for WORKER_URL via localStorage (helps deployed static sites)
try {
  const stored = localStorage.getItem('loreal_worker_url');
  if (!window.WORKER_URL && stored) {
    window.WORKER_URL = stored;
  }
} catch (e) {
  // ignore storage errors
}

// Small helper UI: if WORKER_URL is missing, show an input to let the user set it (persisted to localStorage)
function renderWorkerConfigUI() {
  const container = document.getElementById('workerConfig');
  if (!container) return;
  try {
    const current = (typeof WORKER_URL !== 'undefined' && WORKER_URL) ? WORKER_URL : '';
    if (!current) {
      container.innerHTML = `
        <div class="worker-config-row">
          <label for="workerUrlInput" style="font-size:13px; color:var(--muted);">Worker URL:</label>
          <input id="workerUrlInput" type="text" placeholder="https://your-worker.workers.dev/" style="margin-left:8px; padding:6px; width:320px;">
          <button id="workerUrlSave" style="margin-left:8px; padding:6px 10px;">Save</button>
        </div>`;
      const input = document.getElementById('workerUrlInput');
      const save = document.getElementById('workerUrlSave');
      if (save) {
        save.addEventListener('click', () => {
          const v = (input && input.value) ? input.value.trim() : '';
          if (!v) return;
          try { localStorage.setItem('loreal_worker_url', v); } catch (e) {}
          window.WORKER_URL = v;
          // re-render to show success
          renderWorkerConfigUI();
        });
      }
    } else {
      container.innerHTML = `<div style="font-size:13px; color:var(--muted);">Worker URL configured.</div>`;
    }
  } catch (e) {
    // ignore any UI render errors
  }
}

// Render initial worker config UI
renderWorkerConfigUI();

// Conversation history for multi-turn context (LevelUp requirement)
// Start with a strong system prompt to restrict assistant to L'Oréal topics only.
const systemPrompt = `You are a helpful assistant that ONLY answers questions about L'Oréal products, routines, product recommendations, ingredients, and beauty-related topics associated with L'Oréal brands. If the user asks about anything outside L'Oréal products or beauty routines (finance, politics, unrelated brands, detailed medical advice, illegal activities, etc.), politely refuse and state you can only help with L'Oréal-related beauty/product questions. Keep answers friendly, concise, and use brand-appropriate tone.`;

let messages = [
  { role: "system", content: systemPrompt }
];

// Local storage key for saving conversation (only user/assistant messages)
const STORAGE_KEY = 'loreal_chat_history_v1';

// Initialize chat window: try to restore saved history, otherwise show greeting
chatWindow.innerHTML = '';
function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    console.warn('Failed to parse saved history, clearing it.');
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function saveHistory() {
  try {
    // Persist only user/assistant roles (exclude system prompt)
    const toSave = messages.filter(m => m.role === 'user' || m.role === 'assistant');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn('Failed to save history:', e && e.message ? e.message : e);
  }
}

function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
  messages = [{ role: 'system', content: systemPrompt }];
  chatWindow.innerHTML = '';
  appendAssistantBubble('👋 Hi — ask me about L\'Oréal products, routines, or recommendations.');
}

const restored = loadHistory();
if (restored && restored.length) {
  // Restore into messages (keep system prompt at messages[0])
  messages = [{ role: 'system', content: systemPrompt }, ...restored];

  // Render restored messages into the chat window in order
  restored.forEach((m) => {
    if (m.role === 'user') {
      appendUserBubble(m.content, m.timestamp);
      updateLatestQuestionDisplay(m.content);
    } else if (m.role === 'assistant') {
      appendAssistantBubble(m.content, { timestamp: m.timestamp });
    }
  });
} else {
  // No history: show friendly initial assistant message (not persisted)
  appendAssistantBubble("👋 Hi — ask me about L'Oréal products, routines, or recommendations.");
}

// Ensure WORKER_URL is available from secrets.js
// (secrets.js should define const WORKER_URL = 'https://...')
if (typeof WORKER_URL === 'undefined') {
  // Non-sensitive warning for missing configuration
  console.warn('WORKER_URL is not set. Set WORKER_URL in your local secrets.js for testing.');
}

/* Helper: create and append message rows/bubbles */
function appendUserBubble(text) {
  const row = document.createElement('div');
  row.className = 'message-row user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble user';
  bubble.textContent = text;

  // timestamp (if provided as second arg)
  const ts = arguments[1];
  if (ts) {
    const timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    timeEl.textContent = formatTime(ts);
    bubble.appendChild(timeEl);
  }

  row.appendChild(bubble);
  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function appendAssistantBubble(text, options = {}) {
  const row = document.createElement('div');
  row.className = 'message-row assistant';

  const bubble = document.createElement('div');
  bubble.className = 'bubble assistant';
  if (options.loading) {
    bubble.classList.add('loading');
    bubble.textContent = text;
  } else {
    // allow text + optional timestamp
    bubble.innerHTML = '';
    const textNode = document.createElement('div');
    textNode.textContent = text;
    bubble.appendChild(textNode);
    if (options.timestamp) {
      const timeEl = document.createElement('div');
      timeEl.className = 'msg-time';
      timeEl.textContent = formatTime(options.timestamp);
      bubble.appendChild(timeEl);
    }
  }

  row.appendChild(bubble);
  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  return bubble; // return element so caller can update later
}

function formatTime(ts) {
  try {
    const d = new Date(Number(ts));
    // show local time with short date
    return d.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
  } catch (e) {
    return '';
  }
}

function updateLatestQuestionDisplay(text) {
  // Remove existing latest-question if present
  const existing = document.querySelector('.latest-question');
  if (existing) existing.remove();

  const p = document.createElement('p');
  p.className = 'latest-question';
  p.textContent = `Latest question: ${text}`;
  chatWindow.appendChild(p);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Handle form submit */
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;

  // Show user's question in the UI and record it for history
  const userTs = Date.now();
  appendUserBubble(text, userTs);
  updateLatestQuestionDisplay(text);

  // Add to conversation history (include timestamp)
  messages.push({ role: 'user', content: text, timestamp: userTs });
  // Persist user question right away
  try { saveHistory(); } catch (e) { /* noop */ }

  // Show loading assistant bubble and keep reference to update later
  const loadingBubble = appendAssistantBubble('Thinking...', { loading: true });

  try {
  // When sending to the API/Worker, strip any extra fields (timestamps) and send only role+content
  const apiMessages = messages.map(m => ({ role: m.role, content: m.content }));
  const payload = { messages: apiMessages };

    // Prefer sending to Cloudflare Worker endpoint which uses a secure secret
    if (typeof WORKER_URL !== 'undefined' && WORKER_URL && WORKER_URL !== 'https://your-worker.example.workers.dev') {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`Worker error: ${res.status} ${res.statusText}`);

      const data = await res.json();

      // Cloudflare Worker forwards OpenAI response; get assistant message
    const reply = data?.choices?.[0]?.message?.content || 'Sorry, I could not get an answer.';

    // Remove loading style and set real content with timestamp
    const assistantTs = Date.now();
    loadingBubble.classList.remove('loading');
    // replace bubble content with reply + time
    loadingBubble.innerHTML = '';
    const textNode = document.createElement('div');
    textNode.textContent = reply;
    loadingBubble.appendChild(textNode);
    const timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    timeEl.textContent = formatTime(assistantTs);
    loadingBubble.appendChild(timeEl);

    // Append assistant message to history to keep context (with timestamp)
    messages.push({ role: 'assistant', content: reply, timestamp: assistantTs });
    // Persist after assistant reply
    try { saveHistory(); } catch (e) { /* noop */ }

    } else if (typeof OPENAI_API_KEY !== 'undefined' && OPENAI_API_KEY && OPENAI_API_KEY !== 'REPLACE_WITH_YOUR_OPENAI_KEY') {
      // Fallback: direct call to OpenAI (local dev only). Not secure for production.
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({ model: 'gpt-4o', messages: apiMessages })
      });

      if (!openaiRes.ok) throw new Error(`OpenAI error: ${openaiRes.status} ${openaiRes.statusText}`);
      const data = await openaiRes.json();
    const reply = data?.choices?.[0]?.message?.content || 'Sorry, I could not get an answer.';
    const assistantTs = Date.now();
    loadingBubble.classList.remove('loading');
    loadingBubble.innerHTML = '';
    const textNode = document.createElement('div');
    textNode.textContent = reply;
    loadingBubble.appendChild(textNode);
    const timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    timeEl.textContent = formatTime(assistantTs);
    loadingBubble.appendChild(timeEl);
    messages.push({ role: 'assistant', content: reply, timestamp: assistantTs });
    // Persist after assistant reply
    try { saveHistory(); } catch (e) { /* noop */ }

    } else {
      // No worker URL and no API key
      loadingBubble.classList.remove('loading');
      loadingBubble.textContent = 'Configuration missing: set WORKER_URL in secrets.js to your Cloudflare Worker URL.';
    }

  } catch (err) {
    // Avoid logging full error objects which may include sensitive details
    console.error(err && err.message ? err.message : err);
    loadingBubble.classList.remove('loading');
    loadingBubble.textContent = 'Error: ' + (err?.message || 'Request failed');
  } finally {
    // Clear input for next question
    userInput.value = '';
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
});

// Wire Clear History button with confirmation
const clearBtn = document.getElementById('clearBtn');
if (clearBtn) {
  clearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const ok = confirm('Clear conversation history? This will remove saved messages from this browser.');
    if (ok) {
      clearHistory();
    }
    userInput.focus();
  });
}

// Theme switcher: persist theme and apply as data-theme on body
const themeSelect = document.getElementById('themeSelect');
const THEME_KEY = 'loreal_theme';
function applySavedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY) || 'classic';
    document.body.setAttribute('data-theme', t);
    if (themeSelect) themeSelect.value = t;
  } catch (e) {}
}
if (themeSelect) {
  themeSelect.addEventListener('change', (e) => {
    const v = themeSelect.value || 'classic';
    document.body.setAttribute('data-theme', v);
    try { localStorage.setItem(THEME_KEY, v); } catch (e) {}
  });
}
applySavedTheme();

// Contrast audit helper: computes and logs contrast ratios for key UI pairs
function hexToRgb(hex) {
  const h = hex.replace('#','').trim();
  const bigint = parseInt(h, 16);
  if (h.length === 3) {
    return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
  }
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function relativeLuminance(rgb) {
  const srgb = rgb.map(v => v/255).map((c)=> c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4));
  return 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
}

function contrastRatio(hexA, hexB) {
  try {
    const a = relativeLuminance(hexToRgb(hexA));
    const b = relativeLuminance(hexToRgb(hexB));
    const L1 = Math.max(a,b);
    const L2 = Math.min(a,b);
    return ((L1+0.05)/(L2+0.05));
  } catch (e) { return null; }
}

function runContrastAudit() {
  try {
    const root = getComputedStyle(document.documentElement);
    const pairs = [
      { name: 'Body text vs background', fg: root.getPropertyValue('--text').trim() || '#222222', bg: root.getPropertyValue('--brand-muted').trim() || '#f7f4ef'},
      { name: 'Button text vs brand gold', fg: root.getPropertyValue('--brand-black').trim() || '#000000', bg: root.getPropertyValue('--brand-gold').trim() || '#E3A535'},
      { name: 'User bubble text vs user bg', fg: root.getPropertyValue('--user-text').trim() || '#FFFFFF', bg: root.getPropertyValue('--user-bg').trim() || '#000000'},
      { name: 'Assistant text vs assistant bg', fg: root.getPropertyValue('--text').trim() || '#222222', bg: root.getPropertyValue('--assistant-bg').trim() || '#f3f1ee'}
    ];

    const results = pairs.map(p => ({
      pair: p.name,
      fg: p.fg,
      bg: p.bg,
      contrast: Number((contrastRatio(p.fg, p.bg) || 0).toFixed(2))
    }));

    console.group('Contrast audit');
    console.table(results);
    console.groupEnd();
    return results;
  } catch (e) { console.warn('Contrast audit failed', e); return null; }
}

// Run audit now and whenever theme changes
runContrastAudit();
if (themeSelect) themeSelect.addEventListener('change', runContrastAudit);

// Auto-fix contrast by nudging foreground colors toward black until ratio >= target
function rgbToHex([r,g,b]){
  return '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function clamp(v, a=0, b=255){ return Math.max(a, Math.min(b, Math.round(v))); }

function lerpColor(hexA, hexB, t){
  const a = hexToRgb(hexA); const b = hexToRgb(hexB);
  return rgbToHex([clamp(a[0]+(b[0]-a[0])*t), clamp(a[1]+(b[1]-a[1])*t), clamp(a[2]+(b[2]-a[2])*t)]);
}

function darkenTowardsBlack(hex, step){
  // move color toward #000000 by step fraction (0..1)
  return lerpColor(hex, '#000000', step);
}

function autoFixContrast(target=4.5){
  try{
    const docStyle = document.documentElement.style;
    const computed = getComputedStyle(document.documentElement);

    // Pairs to ensure: body text vs background, assistant text vs assistant bg
    const pairs = [
      { fgVar: '--text', bgVar: '--brand-muted' },
      { fgVar: '--text', bgVar: '--assistant-bg' }
    ];

    let changed = false;
    pairs.forEach(p => {
      let fg = (computed.getPropertyValue(p.fgVar) || '').trim() || '#222222';
      let bg = (computed.getPropertyValue(p.bgVar) || '').trim() || '#ffffff';
      let ratio = contrastRatio(fg, bg) || 0;
      let attempts = 0;
      // only try to darken fg toward black (brand-friendly)
      while(ratio < target && attempts < 24){
        // step increases each attempt a bit
        const step = Math.min(1, 0.06 + attempts*0.02);
        fg = darkenTowardsBlack(fg, step);
        // apply tentatively to root so subsequent reads use updated value
        docStyle.setProperty(p.fgVar, fg);
        // recompute
        const newComputed = getComputedStyle(document.documentElement);
        const newFg = (newComputed.getPropertyValue(p.fgVar)||'').trim() || fg;
        const newBg = (newComputed.getPropertyValue(p.bgVar)||'').trim() || bg;
        ratio = contrastRatio(newFg, newBg) || 0;
        attempts++;
        changed = true;
      }
    });

    if (changed) {
      // persist adjustments so reload keeps them
      try {
        const adjustments = {};
        // collect root-level changed variables we care about
        ['--text','--assistant-bg','--assistant-border','--user-bg','--user-text'].forEach(k=>{
          const v = document.documentElement.style.getPropertyValue(k);
          if (v) adjustments[k] = v.trim();
        });
        localStorage.setItem('loreal_color_adjusts', JSON.stringify(adjustments));
      } catch(e){}
    }
    return true;
  } catch (e){ console.warn('autoFixContrast failed', e); return false; }
}

// Apply persisted adjustments if present
try{
  const adjRaw = localStorage.getItem('loreal_color_adjusts');
  if (adjRaw){
    const adj = JSON.parse(adjRaw);
    Object.keys(adj).forEach(k=>document.documentElement.style.setProperty(k, adj[k]));
  }
}catch(e){}

// Run autofix then audit
autoFixContrast();
runContrastAudit();
if (themeSelect) themeSelect.addEventListener('change', ()=>{ autoFixContrast(); runContrastAudit(); });
