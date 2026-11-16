import type {
  AiPlatform,
  ClipConversionResult,
  ClipConversionStats,
  NoteAsset,
} from '../types/note';

function createAssetId(): string {
  return `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function detectAiPlatform(html: string, plainText = ''): AiPlatform {
  const sample = `${html.slice(0, 4000)} ${plainText.slice(0, 1000)}`.toLowerCase();
  if (sample.includes('data-message-author-role') || sample.includes('chatgpt') || sample.includes('oai-')) {
    return 'ChatGPT';
  }
  if (sample.includes('font-claude') || sample.includes('anthropic') || sample.includes('claude')) {
    return 'Claude';
  }
  if (sample.includes('model-response-text') || sample.includes('bard') || sample.includes('gemini')) {
    return 'Gemini';
  }
  if (sample.includes('perplexity') || sample.includes('citation-chip')) {
    return 'Perplexity';
  }
  if (sample.includes('deepseek')) {
    return 'DeepSeek';
  }
  if (html.trim().length > 0) {
    return 'Web';
  }
  return 'Manual';
}

function escapeMarkdownText(text: string): string {
  return text.replace(/\u00a0/g, ' ');
}

function svgToDataUrl(svgEl: SVGElement): string {
  const clone = svgEl.cloneNode(true) as SVGElement;
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  const rect = svgEl.getBoundingClientRect();
  if (!clone.getAttribute('width') && rect.width > 0) {
    clone.setAttribute('width', String(Math.round(rect.width)));
  }
  if (!clone.getAttribute('height') && rect.height > 0) {
    clone.setAttribute('height', String(Math.round(rect.height)));
  }
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  const encoded = btoa(unescape(encodeURIComponent(svgString)));
  return `data:image/svg+xml;base64,${encoded}`;
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image blob'));
    reader.readAsDataURL(file);
  });
}

function extractLatexFromKatex(el: Element): string | null {
  const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
  if (annotation && annotation.textContent) {
    return annotation.textContent.trim();
  }
  const dataTex = el.getAttribute('data-tex') || el.getAttribute('data-math');
  if (dataTex) {
    return dataTex.trim();
  }
  return null;
}

function cleanPreBlock(preEl: Element): { language: string; code: string } {
  const clone = preEl.cloneNode(true) as Element;
  clone
    .querySelectorAll('button, [role="button"], .copy-code-button, [aria-label*="Copy" i]')
    .forEach((n) => n.remove());

  const codeEl = clone.querySelector('code') || clone;
  let language = '';
  const classList = `${preEl.className || ''} ${codeEl.className || ''}`;
  const langMatch = classList.match(/(?:language-|lang-)([a-z0-9_+-]+)/i);
  if (langMatch) {
    language = langMatch[1].toLowerCase();
  }

  const headerSpan = preEl.querySelector('div > span:first-child');
  if (!language && headerSpan && headerSpan.textContent) {
    const candidate = headerSpan.textContent.trim().toLowerCase();
    if (candidate.length > 0 && candidate.length <= 16 && /^[a-z0-9_+-]+$/.test(candidate)) {
      language = candidate;
      const clonedHeader = clone.querySelector('div');
      if (clonedHeader && clonedHeader.textContent?.trim().toLowerCase() === candidate) {
        clonedHeader.remove();
      }
    }
  }

  const rawCode = (codeEl.textContent || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  return { language, code: rawCode };
}

function convertTableToMarkdown(
  tableEl: Element,
  convertInline: (node: Node) => string
): string {
  const rows: string[][] = [];
  const trList = Array.from(tableEl.querySelectorAll('tr'));
  for (const tr of trList) {
    const cells = Array.from(tr.querySelectorAll('th, td')).map((cell) =>
      convertInline(cell).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
    );
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((r) => r.length));
  const normalizeRow = (r: string[]) => {
    const padded = [...r];
    while (padded.length < colCount) padded.push('');
    return `| ${padded.join(' | ')} |`;
  };

  const header = normalizeRow(rows[0]);
  const separator = `| ${Array(colCount).fill(':---').join(' | ')} |`;
  const body = rows.slice(1).map(normalizeRow);
  return `\n${[header, separator, ...body].join('\n')}\n\n`;
}

export function convertAiHtmlToNote(html: string, plainText = ''): ClipConversionResult {
  const assets: Record<string, NoteAsset> = {};
  const stats: ClipConversionStats = {
    platformDetected: detectAiPlatform(html, plainText),
    equationsRecovered: 0,
    codeBlocksCleaned: 0,
    tablesPreserved: 0,
    imagesEmbedded: 0,
    svgsConverted: 0,
  };

  const parser = new DOMParser();
  const doc = parser.parseFromString(html || `<p>${plainText}</p>`, 'text/html');

  doc.body
    .querySelectorAll('script, style, noscript, button, [aria-hidden="true"]:not(.katex *)')
    .forEach((el) => {
      if (!el.closest('.katex') && !el.closest('mjx-container')) {
        el.remove();
      }
    });

  doc.body.querySelectorAll('.katex-display, .katex, mjx-container, [data-math]').forEach((el) => {
    if (el.classList.contains('katex') && el.closest('.katex-display')) {
      return;
    }
    const tex = extractLatexFromKatex(el);
    if (tex) {
      const isDisplay =
        el.classList.contains('katex-display') ||
        el.getAttribute('display') === 'true' ||
        el.tagName.toLowerCase() === 'p';
      const marker = doc.createTextNode(isDisplay ? `\n$$\n${tex}\n$$\n` : `$${tex}$`);
      el.replaceWith(marker);
      stats.equationsRecovered += 1;
    }
  });

  const convertInline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeMarkdownText(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') {
      const inner = Array.from(el.childNodes).map(convertInline).join('').trim();
      return inner ? `**${inner}**` : '';
    }
    if (tag === 'em' || tag === 'i') {
      const inner = Array.from(el.childNodes).map(convertInline).join('').trim();
      return inner ? `*${inner}*` : '';
    }
    if (tag === 'del' || tag === 's') {
      const inner = Array.from(el.childNodes).map(convertInline).join('').trim();
      return inner ? `~~${inner}~~` : '';
    }
    if (tag === 'code' && !el.closest('pre')) {
      const codeText = (el.textContent || '').trim();
      return codeText ? `\`${codeText}\`` : '';
    }
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      const label = Array.from(el.childNodes).map(convertInline).join('').trim() || href;
      return href ? `[${label}](${href})` : label;
    }
    if (tag === 'img') {
      const src = (el.getAttribute('src') || '').trim();
      const alt = (el.getAttribute('alt') || 'Pasted image').trim();
      if (!src) return '';
      const id = createAssetId();
      assets[id] = {
        id,
        name: `${alt.slice(0, 28).replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'image'}.png`,
        mimeType: src.startsWith('data:image/svg') ? 'image/svg+xml' : 'image/png',
        dataUrl: src,
        caption: alt !== 'Pasted image' ? alt : undefined,
        sourceUrl: src.startsWith('http') ? src : undefined,
        createdAt: Date.now(),
      };
      stats.imagesEmbedded += 1;
      return `\n\n![${alt}](folio-asset://${id})\n\n`;
    }
    if (tag === 'svg') {
      try {
        const dataUrl = svgToDataUrl(el as unknown as SVGElement);
        const id = createAssetId();
        const label = el.getAttribute('aria-label') || 'Captured vector diagram';
        assets[id] = {
          id,
          name: `${id}.svg`,
          mimeType: 'image/svg+xml',
          dataUrl,
          caption: label,
          createdAt: Date.now(),
        };
        stats.svgsConverted += 1;
        stats.imagesEmbedded += 1;
        return `\n\n![${label}](folio-asset://${id})\n\n`;
      } catch {
        return '';
      }
    }

    return Array.from(el.childNodes).map(convertInline).join('');
  };

  const convertList = (listEl: Element, ordered: boolean, depth = 0): string => {
    const indent = '  '.repeat(depth);
    let idx = 1;
    const lines: string[] = [];

    for (const child of Array.from(listEl.children)) {
      if (child.tagName.toLowerCase() !== 'li') continue;
      const checkbox = child.querySelector(':scope > input[type="checkbox"]') as HTMLInputElement | null;
      const prefix = checkbox
        ? `- [${checkbox.checked ? 'x' : ' '}] `
        : ordered
          ? `${idx}. `
          : '- ';

      const inlineParts: string[] = [];
      const nestedParts: string[] = [];

      for (const liNode of Array.from(child.childNodes)) {
        if (liNode.nodeType === Node.ELEMENT_NODE) {
          const liTag = (liNode as Element).tagName.toLowerCase();
          if (liTag === 'ul') {
            nestedParts.push(convertList(liNode as Element, false, depth + 1));
            continue;
          }
          if (liTag === 'ol') {
            nestedParts.push(convertList(liNode as Element, true, depth + 1));
            continue;
          }
          if (liTag === 'input') continue;
        }
        inlineParts.push(convertInline(liNode));
      }

      const text = inlineParts.join('').replace(/\n+/g, ' ').trim();
      if (text) {
        lines.push(`${indent}${prefix}${text}`);
      }
      if (nestedParts.length > 0) {
        lines.push(nestedParts.join('\n'));
      }
      idx += 1;
    }

    return lines.join('\n');
  };

  const convertBlock = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = escapeMarkdownText(node.textContent || '').trim();
      return txt ? `${txt}\n\n` : '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
      const level = Number(tag.slice(1));
      const text = Array.from(el.childNodes).map(convertInline).join('').trim();
      return text ? `${'#'.repeat(level)} ${text}\n\n` : '';
    }
    if (tag === 'pre') {
      const { language, code } = cleanPreBlock(el);
      stats.codeBlocksCleaned += 1;
      return `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    }
    if (tag === 'table') {
      stats.tablesPreserved += 1;
      return convertTableToMarkdown(el, convertInline);
    }
    if (tag === 'ul') {
      return `${convertList(el, false, 0)}\n\n`;
    }
    if (tag === 'ol') {
      return `${convertList(el, true, 0)}\n\n`;
    }
    if (tag === 'blockquote') {
      const inner = Array.from(el.childNodes).map(convertBlock).join('').trim();
      if (!inner) return '';
      return `${inner
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n\n`;
    }
    if (tag === 'hr') {
      return `---\n\n`;
    }
    if (tag === 'img' || tag === 'svg') {
      return convertInline(el);
    }
    if (tag === 'p') {
      const inner = Array.from(el.childNodes).map(convertInline).join('').trim();
      return inner ? `${inner}\n\n` : '';
    }

    const hasBlockChildren = Array.from(el.children).some((c) =>
      ['div', 'p', 'h1', 'h2', 'h3', 'h4', 'pre', 'table', 'ul', 'ol', 'blockquote', 'figure', 'section'].includes(
        c.tagName.toLowerCase()
      )
    );
    if (hasBlockChildren) {
      return Array.from(el.childNodes).map(convertBlock).join('');
    }
    const inline = Array.from(el.childNodes).map(convertInline).join('').trim();
    return inline ? `${inline}\n\n` : '';
  };

  let markdown = Array.from(doc.body.childNodes)
    .map(convertBlock)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!markdown && plainText.trim()) {
    markdown = plainText.trim();
  }

  const headingMatch = markdown.match(/^#{1,3}\s+(.+)$/m);
  const firstLine =
    markdown
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('```') && !l.startsWith('$$') && !l.startsWith('![')) ||
    'Captured AI Note';
  const suggestedTitle = (headingMatch ? headingMatch[1] : firstLine)
    .replace(/[*_`#]/g, '')
    .slice(0, 72)
    .trim();

  return {
    markdown,
    assets,
    suggestedTitle: suggestedTitle || 'Captured AI Note',
    stats,
    rawHtmlPreview: html.slice(0, 4000),
  };
}

async function hydrateRemoteUrlToDataUrl(url: string): Promise<{ dataUrl: string; mimeType: string } | null> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null;
  try {
    const res = await fetch('/api/proxy-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data.dataUrl === 'string' && data.dataUrl.startsWith('data:')) {
      return { dataUrl: data.dataUrl, mimeType: data.mimeType || 'image/png' };
    }
  } catch {
    // ignore network/proxy errors and keep original URL
  }
  return null;
}

export function extractClipboardImages(dt: DataTransfer): Array<{ file: Blob; name?: string }> {
  const blobs: Array<{ file: Blob; name?: string }> = [];
  const seen = new Set<string>();

  for (const item of Array.from(dt.items || [])) {
    if (item.kind === 'file' || item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f && (f.type.startsWith('image/') || item.type.startsWith('image/'))) {
        const key = `${f.size}:${f.type}:${f.name}`;
        if (!seen.has(key)) {
          seen.add(key);
          blobs.push({ file: f, name: f.name || `pasted-image-${blobs.length + 1}.png` });
        }
      }
    }
  }

  for (const file of Array.from(dt.files || [])) {
    if (file.type.startsWith('image/')) {
      const key = `${file.size}:${file.type}:${file.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        blobs.push({ file, name: file.name || `pasted-image-${blobs.length + 1}.png` });
      }
    }
  }

  return blobs;
}

export async function processClipboardPayload(
  html: string,
  plainText: string,
  imageBlobs: Array<{ file: Blob; name?: string }>
): Promise<ClipConversionResult> {
  const result = convertAiHtmlToNote(html, plainText);

  // Convert any binary clipboard images into data URLs upfront
  const binaryDataUrls = await Promise.all(
    imageBlobs.map(async (item, idx) => ({
      dataUrl: await fileToDataUrl(item.file),
      mimeType: item.file.type || 'image/png',
      name: item.name || `pasted-image-${idx + 1}.png`,
    }))
  );

  let binaryConsumeIdx = 0;

  // 1) Fix cross-origin blob: URLs & hydrate remote https:// URLs found inside pasted HTML
  await Promise.all(
    Object.values(result.assets).map(async (asset) => {
      if (asset.dataUrl.startsWith('blob:')) {
        // Cross-origin blob: URLs cannot load outside the source tab.
        // Swap with a binary clipboard image if present, otherwise remove broken placeholder.
        if (binaryConsumeIdx < binaryDataUrls.length) {
          const replacement = binaryDataUrls[binaryConsumeIdx++];
          asset.dataUrl = replacement.dataUrl;
          asset.mimeType = replacement.mimeType;
          asset.name = replacement.name;
        } else {
          delete result.assets[asset.id];
          result.markdown = result.markdown.replace(
            new RegExp(`!\\[[^\\]]*\\]\\(folio-asset://${asset.id}\\)`, 'g'),
            ''
          );
          result.stats.imagesEmbedded = Math.max(0, result.stats.imagesEmbedded - 1);
        }
        return;
      }

      if (asset.dataUrl.startsWith('http://') || asset.dataUrl.startsWith('https://')) {
        const hydrated = await hydrateRemoteUrlToDataUrl(asset.dataUrl);
        if (hydrated) {
          asset.dataUrl = hydrated.dataUrl;
          asset.mimeType = hydrated.mimeType;
        }
      }
    })
  );

  // 2) If HTML had NO images (or had fewer images than binary clipboard blobs),
  //    ALWAYS embed the remaining binary clipboard images alongside the text!
  const remainingBlobs = binaryDataUrls.slice(binaryConsumeIdx);
  const hasHtmlImages = Object.keys(result.assets).length > 0;

  // Note: when copying a single image from a browser, Chrome sometimes puts BOTH
  // `<img src="...">` in text/html AND the same PNG in clipboardData.items.
  // If HTML was literally just an <img> wrapper with no real prose text, don't duplicate it.
  const strippedText = result.markdown.replace(/!\[[^\]]*\]\(folio-asset:\/\/[^)]+\)/g, '').trim();
  const isPureSingleImageWrapper = hasHtmlImages && strippedText.length === 0 && remainingBlobs.length === 1;

  if (!isPureSingleImageWrapper) {
    for (const item of remainingBlobs) {
      const id = createAssetId();
      result.assets[id] = {
        id,
        name: item.name,
        mimeType: item.mimeType,
        dataUrl: item.dataUrl,
        caption: item.name.replace(/\.[^.]+$/, ''),
        createdAt: Date.now(),
      };
      result.stats.imagesEmbedded += 1;
      result.markdown = `${result.markdown}\n\n![${item.name.replace(/\.[^.]+$/, '')}](folio-asset://${id})`.trim();
    }
  }

  if (Object.keys(result.assets).length > 0 && strippedText.length === 0) {
    result.suggestedTitle = 'Screenshot Note';
  }

  return result;
}
