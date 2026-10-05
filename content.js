const originalText = new Map();
let isEnabled = true;
let targetLanguage = 'ar';
let apiKey = '';
let translationRun = Promise.resolve();

chrome.storage.sync.get({ enabled: true, target: 'ar' }, (settings) => {
  isEnabled = settings.enabled;
  targetLanguage = settings.target;
  if (isEnabled) startTranslation();
  else restorePage();
});

chrome.storage.local.get({ apiKey: '' }, (settings) => {
  apiKey = settings.apiKey;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.enabled) isEnabled = changes.enabled.newValue;
    if (changes.target) targetLanguage = changes.target.newValue;
  }
  if (area === 'local' && changes.apiKey) apiKey = changes.apiKey.newValue || '';
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'DISABLE') {
    isEnabled = false;
    restorePage();
    sendResponse({ translated: 0, failed: 0 });
    return;
  }
  if (message.type === 'CONFIG_CHANGED') {
    isEnabled = true;
    startTranslation().then(sendResponse);
    return true;
  }
  if (message.type === 'TRANSLATE') {
    isEnabled = true;
    startTranslation().then(sendResponse);
    return true;
  }
});

function startTranslation() {
  translationRun = translationRun.then(async () => {
    applyRTL();
    const nodes = collectTextNodes(document.body).filter((node) => {
      const text = originalText.get(node) ?? node.nodeValue;
      return text && text.trim().length > 0;
    });
    const result = await translateNodes(nodes);
    return result;
  });
  return translationRun;
}

function applyRTL() {
  document.documentElement.setAttribute('dir', 'rtl');
}

function restorePage() {
  for (const [node, text] of originalText) {
    if (node.isConnected) node.nodeValue = text;
  }
  originalText.clear();
  document.documentElement.removeAttribute('dir');
}

function collectTextNodes(root) {
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, noscript, textarea, input, code, pre, svg, [contenteditable="true"]')) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!node.nodeValue.trim() || parent.getClientRects().length === 0) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

async function translateNodes(nodes) {
  let translated = 0;
  let failed = 0;
  const pending = nodes.map((node) => {
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    return { node, text: originalText.get(node) };
  });

  if (apiKey) {
    for (let offset = 0; offset < pending.length; offset += 50) {
      const batch = pending.slice(offset, offset + 50);
      try {
        const results = await translateWithCloud(batch.map((entry) => entry.text));
        batch.forEach((entry, index) => {
          if (entry.node.isConnected && results[index]) {
            entry.node.nodeValue = results[index];
            translated++;
          }
        });
      } catch {
        failed += batch.length;
      }
    }
  } else {
    let cursor = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (cursor < pending.length) {
        const entry = pending[cursor++];
        try {
          const result = await translateWithPublicEndpoint(entry.text);
          if (entry.node.isConnected && result) {
            entry.node.nodeValue = result;
            translated++;
          }
        } catch {
          failed++;
        }
      }
    });
    await Promise.all(workers);
  }
  return { translated, failed };
}

async function translateWithCloud(texts) {
  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, target: targetLanguage, format: 'text' }),
  });
  if (!response.ok) throw new Error(`Google Cloud Translation returned ${response.status}`);
  const payload = await response.json();
  return payload.data.translations.map((entry) => entry.translatedText);
}

async function translateWithPublicEndpoint(text) {
  const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: targetLanguage, dt: 't', q: text });
  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`);
  if (!response.ok) throw new Error(`Google Translate returned ${response.status}`);
  const payload = await response.json();
  return payload[0].map((segment) => segment[0]).join('');
}