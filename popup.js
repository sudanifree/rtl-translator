if (typeof document !== 'undefined') {
  const enabledToggle = document.querySelector('#enabled');
  const apiKeyInput = document.querySelector('#api-key');
  const status = document.querySelector('#status');

  if (enabledToggle && apiKeyInput && status) {
    const chromeApi = typeof chrome !== 'undefined' ? chrome : null;

    if (chromeApi?.storage && chromeApi?.tabs) {
      chromeApi.storage.sync?.get({ enabled: true }, (settings) => {
        enabledToggle.checked = settings.enabled;
      });

      chromeApi.storage.local?.get({ apiKey: '' }, (settings) => {
        apiKeyInput.value = settings.apiKey;
      });

      enabledToggle.addEventListener('change', async () => {
        await chromeApi.storage.sync?.set({ enabled: enabledToggle.checked });
        await notifyActiveTab({ type: enabledToggle.checked ? 'CONFIG_CHANGED' : 'DISABLE' });
        status.textContent = enabledToggle.checked ? 'الترجمة التلقائية مفعّلة' : 'الترجمة التلقائية متوقفة';
      });

      document.querySelector('#translate')?.addEventListener('click', async () => {
        status.textContent = 'جارٍ ترجمة الصفحة...';
        try {
          const result = await notifyActiveTab({ type: 'TRANSLATE' });
          showResult(result);
        } catch {
          status.textContent = 'تعذّر الوصول إلى هذه الصفحة';
        }
      });

      document.querySelector('#save-key')?.addEventListener('click', async () => {
        await chromeApi.storage.local?.set({ apiKey: apiKeyInput.value.trim() });
        status.textContent = apiKeyInput.value.trim()
          ? 'تم حفظ المفتاح على هذا الجهاز'
          : 'تمت إزالة المفتاح';
      });

      async function notifyActiveTab(message) {
        const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('No active tab');
        return chromeApi.tabs.sendMessage(tab.id, message);
      }
    }
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
}