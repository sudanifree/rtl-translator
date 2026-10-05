const languageSelect = document.querySelector('#language');
const enabledToggle = document.querySelector('#enabled');
const apiKeyInput = document.querySelector('#api-key');
const status = document.querySelector('#status');

chrome.storage.sync.get({ enabled: true, target: 'ar' }, (settings) => {
  enabledToggle.checked = settings.enabled;
  languageSelect.value = settings.target;
});

chrome.storage.local.get({ apiKey: '' }, (settings) => {
  apiKeyInput.value = settings.apiKey;
});

languageSelect.addEventListener('change', async () => {
  await chrome.storage.sync.set({ target: languageSelect.value });
  await notifyActiveTab({ type: 'CONFIG_CHANGED' });
  status.textContent = 'تم تحديث لغة الترجمة';
});

enabledToggle.addEventListener('change', async () => {
  await chrome.storage.sync.set({ enabled: enabledToggle.checked });
  await notifyActiveTab({ type: enabledToggle.checked ? 'CONFIG_CHANGED' : 'DISABLE' });
  status.textContent = enabledToggle.checked ? 'الترجمة التلقائية مفعّلة' : 'الترجمة التلقائية متوقفة';
});

document.querySelector('#translate').addEventListener('click', async () => {
  status.textContent = 'جارٍ ترجمة الصفحة...';
  try {
    const result = await notifyActiveTab({ type: 'TRANSLATE' });
    showResult(result);
  } catch {
    status.textContent = 'تعذّر الوصول إلى هذه الصفحة';
  }
});

document.querySelector('#save-key').addEventListener('click', async () => {
  await chrome.storage.local.set({ apiKey: apiKeyInput.value.trim() });
  status.textContent = apiKeyInput.value.trim()
    ? 'تم حفظ المفتاح على هذا الجهاز'
    : 'تمت إزالة المفتاح';
});

async function notifyActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return chrome.tabs.sendMessage(tab.id, message);
}

function showResult(result) {
  if (!result) {
    status.textContent = 'تعذّر بدء الترجمة في هذه الصفحة';
  } else if (result.failed > 0) {
    status.textContent = `تُرجمت ${result.translated} مقاطع؛ تعذّر ${result.failed}. قد تكون الخدمة قد فرضت حدّاً مؤقتاً.`;
  } else {
    status.textContent = `اكتملت الترجمة: ${result.translated} مقطعاً`;
  }
}