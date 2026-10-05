# RTL Translator

A Chrome Manifest V3 extension that translates webpages into Arabic with Google Translate and switches the page direction to right-to-left. It runs automatically on regular webpages and also supports manual translation from the toolbar popup.

## Load in Chrome

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this folder.
3. Open a regular webpage. Translation is enabled by default; use the extension popup to change the target language, disable automatic translation, or translate the current page on demand.

The extension uses Google's public web translation endpoint by default. That endpoint is undocumented and may rate-limit or change. For more reliable use, create a Google Cloud Translation API key and enter it in the popup; Google Cloud may require billing to be enabled. The key is stored locally in Chrome extension storage.

Browser-internal pages, the Chrome Web Store, and other restricted pages cannot be modified by extensions.