const originalText = new Map();
const originalDirections = new Map();
let isEnabled = true;
let targetLanguage = 'ar';
let apiKey = '';
let translationRun = Promise.resolve();
let originalRootAttributes;
let pageObserver;

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
    observePage();
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
  if (!originalRootAttributes) {
    originalRootAttributes = {
      dir: document.documentElement.getAttribute('dir'),
      lang: document.documentElement.getAttribute('lang'),
    };
  }
  document.documentElement.setAttribute('dir', 'rtl');
  document.documentElement.setAttribute('lang', targetLanguage);
  applyTechnicalDirections(document.body);
}

function observePage() {
  if (!document.body) return;
  if (!pageObserver) {
    pageObserver = new MutationObserver((mutations) => {
      if (!isEnabled) return;
      const addedNodes = new Set();
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            if (isTranslatableTextNode(node)) addedNodes.add(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            applyTechnicalDirections(node);
            for (const textNode of collectTextNodes(node)) addedNodes.add(textNode);
          }
        }
      }
      if (addedNodes.size > 0) {
        translationRun = translationRun.then(() => translateNodes([...addedNodes]));
      }
    });
  }
  pageObserver.observe(document.body, { childList: true, subtree: true });
}

function restorePage() {
  pageObserver?.disconnect();
  for (const [node, text] of originalText) {
    if (node.isConnected) node.nodeValue = text;
  }
  originalText.clear();
  for (const [element, direction] of originalDirections) {
    if (!element.isConnected) continue;
    if (direction === null) element.removeAttribute('dir');
    else element.setAttribute('dir', direction);
  }
  originalDirections.clear();
  if (originalRootAttributes) {
    for (const [attribute, value] of Object.entries(originalRootAttributes)) {
      if (value === null) document.documentElement.removeAttribute(attribute);
      else document.documentElement.setAttribute(attribute, value);
    }
    originalRootAttributes = undefined;
  }
}

function applyTechnicalDirections(root) {
  if (!root) return;
  if (root.matches?.('code, pre, kbd, samp')) setDirection(root, 'ltr');
  root.querySelectorAll?.('code, pre, kbd, samp').forEach((element) => {
    setDirection(element, 'ltr');
  });
}

function setDirection(element, direction) {
  if (!originalDirections.has(element)) {
    originalDirections.set(element, element.getAttribute('dir'));
  }
  element.setAttribute('dir', direction);
}

function collectTextNodes(root) {
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isTranslatableTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function isTranslatableTextNode(node) {
  const parent = node.parentElement;
  return Boolean(
    parent &&
    !parent.closest('script, style, noscript, textarea, input, code, pre, svg, [contenteditable="true"]') &&
    node.nodeValue.trim() &&
    parent.getClientRects().length > 0
  );
}

async function translateNodes(nodes) {
  let translated = 0;
  let failed = 0;
  const pending = nodes.map((node) => {
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const text = originalText.get(node);
    const leadingWhitespace = text.match(/^\s*/u)[0];
    const trailingWhitespace = text.match(/\s*$/u)[0];
    return {
      node,
      text: text.slice(leadingWhitespace.length, text.length - trailingWhitespace.length),
      leadingWhitespace,
      trailingWhitespace,
    };
  });

  if (apiKey) {
    for (let offset = 0; offset < pending.length; offset += 50) {
      const batch = pending.slice(offset, offset + 50);
      try {
        const results = await translateWithCloud(batch.map((entry) => entry.text));
        batch.forEach((entry, index) => {
          if (isEnabled && entry.node.isConnected && results[index]) {
            setDirection(entry.node.parentElement, 'rtl');
            entry.node.nodeValue = `${entry.leadingWhitespace}${results[index]}${entry.trailingWhitespace}`;
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
          if (isEnabled && entry.node.isConnected && result) {
            setDirection(entry.node.parentElement, 'rtl');
            entry.node.nodeValue = `${entry.leadingWhitespace}${result}${entry.trailingWhitespace}`;
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