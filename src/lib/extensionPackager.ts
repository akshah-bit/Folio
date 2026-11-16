import JSZip from 'jszip';

export interface ExtensionFileEntry {
  path: string;
  language: string;
  description: string;
  content: string;
}

function createManifestJson(): string {
  return JSON.stringify(
    {
      manifest_version: 3,
      name: 'Folio AI Note Clipper',
      version: '1.0.0',
      description:
        'Capture AI responses from ChatGPT, Claude, Gemini, and Perplexity with exact LaTeX math, tables, code blocks, and embedded images.',
      permissions: ['activeTab', 'clipboardWrite', 'storage', 'scripting'],
      host_permissions: [
        'https://chatgpt.com/*',
        'https://chat.openai.com/*',
        'https://claude.ai/*',
        'https://gemini.google.com/*',
        'https://www.perplexity.ai/*',
        'https://chat.deepseek.com/*',
      ],
      action: {
        default_popup: 'popup.html',
        default_title: 'Clip AI Response to Folio',
        default_icon: {
          '16': 'icons/icon16.png',
          '48': 'icons/icon48.png',
          '128': 'icons/icon128.png',
        },
      },
      icons: {
        '16': 'icons/icon16.png',
        '48': 'icons/icon48.png',
        '128': 'icons/icon128.png',
      },
      background: {
        service_worker: 'background.js',
      },
      content_scripts: [
        {
          matches: [
            'https://chatgpt.com/*',
            'https://chat.openai.com/*',
            'https://claude.ai/*',
            'https://gemini.google.com/*',
            'https://www.perplexity.ai/*',
            'https://chat.deepseek.com/*',
          ],
          js: ['content.js'],
          run_at: 'document_idle',
        },
      ],
      commands: {
        'clip-latest-response': {
          suggested_key: {
            default: 'Alt+Shift+S',
            mac: 'Command+Shift+S',
          },
          description: 'Clip the latest AI response with images and math',
        },
      },
    },
    null,
    2
  );
}

function createBackgroundJs(): string {
  return `// Folio MV3 Background Service Worker
// Handles cross-origin image hydration and keyboard shortcuts.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_IMAGE_BASE64') {
    fetch(message.url)
      .then((res) => res.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ ok: true, dataUrl: reader.result });
        reader.onerror = () => sendResponse({ ok: false });
        reader.readAsDataURL(blob);
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'clip-latest-response') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'CLIP_LATEST_AI_RESPONSE' });
  }
});
`;
}

function createContentJs(targetAppUrl: string): string {
  return `// Folio Content Script: Exact Format + Image Hydration Extractor
const DEFAULT_FOLIO_URL = ${JSON.stringify(targetAppUrl)};

function detectPlatform() {
  const host = location.hostname;
  if (host.includes('chatgpt') || host.includes('openai')) return 'ChatGPT';
  if (host.includes('claude')) return 'Claude';
  if (host.includes('gemini')) return 'Gemini';
  if (host.includes('perplexity')) return 'Perplexity';
  if (host.includes('deepseek')) return 'DeepSeek';
  return 'Web';
}

function findLatestAiMessageNode() {
  const selectors = [
    '[data-message-author-role="assistant"]',
    '.font-claude-message',
    'model-response .markdown',
    '.prose',
    'article',
  ];
  for (const sel of selectors) {
    const matches = document.querySelectorAll(sel);
    if (matches.length > 0) return matches[matches.length - 1];
  }
  return null;
}

async function hydrateImagesToDataUrls(rootClone) {
  const imgs = Array.from(rootClone.querySelectorAll('img'));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return;
      try {
        const res = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_BASE64', url: src });
        if (res && res.ok && res.dataUrl) {
          img.setAttribute('src', res.dataUrl);
        }
      } catch {
        // Fallback: preserve original URL if background fetch fails
      }
    })
  );

  // Convert inline SVGs (diagrams/charts) into portable data-URI images
  Array.from(rootClone.querySelectorAll('svg')).forEach((svg) => {
    if (svg.closest('.katex')) return;
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const serialized = new XMLSerializer().serializeToString(svg);
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(serialized)));
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = svg.getAttribute('aria-label') || 'AI Diagram';
    svg.replaceWith(img);
  });
}

function scrubAiChrome(rootClone) {
  rootClone.querySelectorAll('button, [role="button"], .copy-code-button').forEach((b) => b.remove());
  rootClone.querySelectorAll('.katex-display, .katex, mjx-container').forEach((mathEl) => {
    const ann = mathEl.querySelector('annotation[encoding="application/x-tex"]');
    if (ann && ann.textContent) {
      const isBlock = mathEl.classList.contains('katex-display');
      const texNode = document.createTextNode(
        isBlock ? '\\n$$\\n' + ann.textContent.trim() + '\\n$$\\n' : '$' + ann.textContent.trim() + '$'
      );
      mathEl.replaceWith(texNode);
    }
  });
}

async function captureLatestResponse(openInFolio = false) {
  const target = findLatestAiMessageNode();
  if (!target) {
    return { ok: false, error: 'No AI response container found on this page.' };
  }
  const clone = target.cloneNode(true);
  await hydrateImagesToDataUrls(clone);
  scrubAiChrome(clone);

  const html = clone.innerHTML;
  const plainText = clone.innerText || clone.textContent || '';
  const payload = {
    platform: detectPlatform(),
    sourceUrl: location.href,
    title: document.title || 'AI Study Clip',
    html,
    plainText,
    capturedAt: Date.now(),
  };

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(plainText);
  }

  if (openInFolio) {
    const stored = await chrome.storage.sync.get({ folioUrl: DEFAULT_FOLIO_URL });
    const baseUrl = (stored.folioUrl || DEFAULT_FOLIO_URL).replace(/\\/$/, '');
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    window.open(baseUrl + '/#clip=' + encodeURIComponent(encoded), '_blank');
  }

  return { ok: true, platform: payload.platform, length: html.length };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CLIP_LATEST_AI_RESPONSE') {
    captureLatestResponse(Boolean(msg.openInFolio)).then(sendResponse);
    return true;
  }
});
`;
}

function createPopupHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Folio Clipper</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <main class="panel">
    <header class="header">
      <span class="brand">Folio</span>
      <span class="sub">AI Note Clipper</span>
    </header>
    <p class="desc">
      Extracts the latest AI reply with LaTeX annotations, tables, code blocks, and base64-hydrated images.
    </p>
    <div class="actions">
      <button id="btn-copy" class="btn-primary">Copy Clean Format + Images</button>
      <button id="btn-send" class="btn-secondary">Send Directly to Folio</button>
    </div>
    <label class="field">
      <span>Folio Workspace URL</span>
      <input id="folio-url" type="url" placeholder="https://your-folio-app.url" />
    </label>
    <div id="status" class="status"></div>
  </main>
  <script src="popup.js"></script>
</body>
</html>
`;
}

function createPopupCss(): string {
  return `* { box-sizing: border-box; }
body { margin: 0; width: 300px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #ffffff; color: #0f172a; }
.panel { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.header { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
.brand { font-weight: 700; font-size: 16px; letter-spacing: -0.02em; }
.sub { font-size: 12px; color: #64748b; }
.desc { margin: 0; font-size: 12.5px; line-height: 1.5; color: #475569; }
.actions { display: flex; flex-direction: column; gap: 8px; }
button { width: 100%; padding: 9px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
.btn-primary { background: #2563eb; color: #ffffff; }
.btn-primary:hover { background: #1d4ed8; }
.btn-secondary { background: #f8fafc; color: #0f172a; border-color: #cbd5e1; }
.btn-secondary:hover { background: #f1f5f9; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: #64748b; }
.field input { padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; color: #0f172a; }
.status { font-size: 12px; color: #059669; min-height: 16px; }
`;
}

function createPopupJs(targetAppUrl: string): string {
  return `const urlInput = document.getElementById('folio-url');
const statusEl = document.getElementById('status');

chrome.storage.sync.get({ folioUrl: ${JSON.stringify(targetAppUrl)} }, (data) => {
  urlInput.value = data.folioUrl;
});

urlInput.addEventListener('change', () => {
  chrome.storage.sync.set({ folioUrl: urlInput.value.trim() });
});

async function triggerClip(openInFolio) {
  statusEl.textContent = 'Hydrating images & math...';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    statusEl.textContent = 'No active tab found.';
    return;
  }
  chrome.tabs.sendMessage(
    tab.id,
    { type: 'CLIP_LATEST_AI_RESPONSE', openInFolio },
    (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        statusEl.textContent = (res && res.error) || 'Open ChatGPT, Claude, Gemini, or Perplexity first.';
        return;
      }
      statusEl.textContent = 'Captured from ' + res.platform + '!';
    }
  );
}

document.getElementById('btn-copy').addEventListener('click', () => triggerClip(false));
document.getElementById('btn-send').addEventListener('click', () => triggerClip(true));
`;
}

function createReadme(targetAppUrl: string): string {
  return `Folio Chrome Extension (Manifest V3)
===================================

Install in 30 seconds:
1. Unzip this folder to a permanent location on Windows or macOS.
2. Open Chrome / Edge / Brave / Arc and go to: chrome://extensions
3. Enable "Developer mode" in the top-right corner.
4. Click "Load unpacked" and select this unzipped folder.
5. Open ChatGPT, Claude, Gemini, or Perplexity, click the Folio extension icon (or press Alt+Shift+S / Cmd+Shift+S), and choose "Copy Clean Format + Images" or "Send Directly to Folio".

Configured Folio Workspace URL: ${targetAppUrl}
`;
}

async function renderPngIcon(size: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0F172A';
    const r = Math.max(3, Math.round(size * 0.22));
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();

    // Clean cobalt page fold mark
    ctx.fillStyle = '#2563EB';
    const pad = Math.round(size * 0.22);
    ctx.fillRect(pad, pad, size - pad * 2, Math.max(2, Math.round(size * 0.14)));

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${Math.round(size * 0.48)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('F', size / 2, size * 0.62);
  }
  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export function getExtensionSourceFiles(targetAppUrl: string): ExtensionFileEntry[] {
  return [
    {
      path: 'manifest.json',
      language: 'json',
      description: 'Manifest V3 declaration, host permissions, and global shortcut.',
      content: createManifestJson(),
    },
    {
      path: 'content.js',
      language: 'javascript',
      description: 'Extracts AI DOM, recovers TeX math annotations, and hydrates images/SVGs to base64.',
      content: createContentJs(targetAppUrl),
    },
    {
      path: 'background.js',
      language: 'javascript',
      description: 'Service worker that bypasses page CORS to fetch remote AI images as base64.',
      content: createBackgroundJs(),
    },
    {
      path: 'popup.html',
      language: 'html',
      description: 'Extension popup markup for one-click capture or direct workspace handoff.',
      content: createPopupHtml(),
    },
    {
      path: 'popup.css',
      language: 'css',
      description: 'Clean neutral styling for the browser extension popup.',
      content: createPopupCss(),
    },
    {
      path: 'popup.js',
      language: 'javascript',
      description: 'Popup controller that triggers extraction and stores your Folio URL.',
      content: createPopupJs(targetAppUrl),
    },
    {
      path: 'README.txt',
      language: 'text',
      description: 'Step-by-step instructions to load unpacked in Chrome, Edge, Brave, or Arc.',
      content: createReadme(targetAppUrl),
    },
  ];
}

export async function downloadExtensionZip(targetAppUrl: string): Promise<void> {
  const zip = new JSZip();
  const files = getExtensionSourceFiles(targetAppUrl);
  for (const f of files) {
    zip.file(f.path, f.content);
  }
  const iconsFolder = zip.folder('icons');
  if (iconsFolder) {
    const [i16, i48, i128] = await Promise.all([
      renderPngIcon(16),
      renderPngIcon(48),
      renderPngIcon(128),
    ]);
    iconsFolder.file('icon16.png', i16);
    iconsFolder.file('icon48.png', i48);
    iconsFolder.file('icon128.png', i128);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'folio-chrome-extension-mv3.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
