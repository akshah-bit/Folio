import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import type { Note, NoteAsset } from '../types/note';
import { renderNoteToSanitizedHtml } from './markdownRenderer';

export interface PdfExportOptions {
  notebookName?: string;
  pageSize?: 'a4' | 'letter';
  includeMetadata?: boolean;
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'folio-note'
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function resolveImageUrlToDataUrl(url: string): Promise<string> {
  if (!url || url.startsWith('data:')) return url;

  // Local bundled/public paths (e.g. /src/assets/images/...)
  if (url.startsWith('/') || url.startsWith(window.location.origin)) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return url;
      const blob = await resp.blob();
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || url));
        reader.onerror = () => resolve(url);
        reader.readAsDataURL(blob);
      });
    } catch {
      return url;
    }
  }

  // External URLs via server-side image proxy to prevent canvas CORS taint
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const resp = await fetch('/api/proxy-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.dataUrl && typeof data.dataUrl === 'string') {
          return data.dataUrl;
        }
      }
    } catch {
      // keep original URL if proxy fails
    }
  }

  return url;
}

async function resolveNoteAssetsForPdf(
  assets: Record<string, NoteAsset>
): Promise<Record<string, NoteAsset>> {
  const entries = Object.entries(assets || {});
  const resolvedEntries = await Promise.all(
    entries.map(async ([id, asset]) => {
      const dataUrl = await resolveImageUrlToDataUrl(asset.dataUrl);
      return [id, { ...asset, dataUrl }] as const;
    })
  );
  return Object.fromEntries(resolvedEntries);
}

function buildPdfStylesheet(): string {
  return `
    .folio-pdf-sheet {
      box-sizing: border-box;
      width: 760px;
      background: #ffffff;
      color: #1e293b;
      font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14.5px;
      line-height: 1.68;
      padding: 0;
      margin: 0;
    }
    .folio-pdf-sheet *, .folio-pdf-sheet *::before, .folio-pdf-sheet *::after {
      box-sizing: border-box;
    }
    .folio-pdf-header {
      padding-bottom: 16px;
      margin-bottom: 20px;
      border-bottom: 1px solid #e2e8f0;
    }
    .folio-pdf-eyebrow {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 8px;
    }
    .folio-pdf-title {
      font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 26px;
      font-weight: 700;
      line-height: 1.24;
      letter-spacing: -0.02em;
      color: #0f172a;
      margin: 0;
      word-break: break-word;
    }
    .folio-pdf-source-url {
      margin-top: 6px;
      font-size: 11.5px;
      color: #2563eb;
      word-break: break-all;
    }
    .folio-pdf-body h1 {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 22px;
      font-weight: 700;
      line-height: 1.28;
      color: #0f172a;
      margin: 24px 0 10px 0;
    }
    .folio-pdf-body h2 {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 18px;
      font-weight: 600;
      line-height: 1.32;
      color: #0f172a;
      margin: 22px 0 10px 0;
      padding-bottom: 5px;
      border-bottom: 1px solid #e2e8f0;
    }
    .folio-pdf-body h3 {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 15.5px;
      font-weight: 600;
      line-height: 1.38;
      color: #0f172a;
      margin: 18px 0 8px 0;
    }
    .folio-pdf-body p {
      margin: 0 0 12px 0;
      color: #1e293b;
    }
    .folio-pdf-body ul {
      list-style-type: disc;
      padding-left: 22px;
      margin: 8px 0 14px 0;
    }
    .folio-pdf-body ol {
      list-style-type: decimal;
      padding-left: 22px;
      margin: 8px 0 14px 0;
    }
    .folio-pdf-body li {
      margin: 4px 0;
    }
    .folio-pdf-body li.folio-pdf-task-item {
      list-style-type: none;
      margin-left: -18px;
    }
    .folio-pdf-checkbox {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 13px;
      height: 13px;
      margin-right: 7px;
      border-radius: 3px;
      border: 1.5px solid #94a3b8;
      font-size: 10px;
      line-height: 1;
      vertical-align: -1px;
      background: #ffffff;
      color: #ffffff;
    }
    .folio-pdf-checkbox.checked {
      background: #2563eb;
      border-color: #2563eb;
    }
    .folio-pdf-body blockquote {
      margin: 14px 0;
      padding: 12px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      color: #475569;
    }
    .folio-pdf-body blockquote p:last-child {
      margin-bottom: 0;
    }
    .folio-pdf-body :not(pre) > code {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 12.5px;
      padding: 2px 5px;
      border-radius: 4px;
      background: #f1f5f9;
      color: #0f172a;
      border: 1px solid #e2e8f0;
    }
    .folio-pdf-body .folio-code-wrap {
      margin: 14px 0;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      overflow: hidden;
    }
    .folio-pdf-body .folio-code-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #e2e8f0;
      background: #f1f5f9;
      padding: 5px 12px;
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 11px;
      color: #475569;
    }
    .folio-pdf-body pre {
      margin: 0;
      padding: 12px 14px;
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 12px;
      line-height: 1.55;
      color: #0f172a;
      white-space: pre-wrap;
      word-break: break-word;
      overflow: visible;
    }
    .folio-pdf-body .hljs-keyword,
    .folio-pdf-body .hljs-selector-tag,
    .folio-pdf-body .hljs-literal,
    .folio-pdf-body .hljs-section,
    .folio-pdf-body .hljs-link { color: #2563eb; }
    .folio-pdf-body .hljs-string,
    .folio-pdf-body .hljs-title,
    .folio-pdf-body .hljs-name,
    .folio-pdf-body .hljs-type,
    .folio-pdf-body .hljs-attribute,
    .folio-pdf-body .hljs-symbol,
    .folio-pdf-body .hljs-bullet,
    .folio-pdf-body .hljs-addition { color: #059669; }
    .folio-pdf-body .hljs-comment,
    .folio-pdf-body .hljs-quote,
    .folio-pdf-body .hljs-meta { color: #64748b; font-style: italic; }
    .folio-pdf-body .hljs-number,
    .folio-pdf-body .hljs-regexp,
    .folio-pdf-body .hljs-variable,
    .folio-pdf-body .hljs-template-variable { color: #d97706; }
    .folio-pdf-body .hljs-function .hljs-title,
    .folio-pdf-body .hljs-built_in { color: #0284c7; }

    .folio-pdf-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 13px;
      border: 1px solid #e2e8f0;
      table-layout: auto;
    }
    .folio-pdf-body th {
      text-align: left;
      font-family: "Plus Jakarta Sans", sans-serif;
      font-weight: 600;
      padding: 8px 10px;
      background: #f8fafc;
      border-bottom: 1px solid #cbd5e1;
      border-right: 1px solid #e2e8f0;
      color: #0f172a;
    }
    .folio-pdf-body td {
      padding: 7px 10px;
      border-bottom: 1px solid #e2e8f0;
      border-right: 1px solid #f1f5f9;
      color: #1e293b;
      vertical-align: top;
      word-break: break-word;
    }
    .folio-pdf-body th:last-child,
    .folio-pdf-body td:last-child {
      border-right: none;
    }
    .folio-pdf-body tr:last-child td {
      border-bottom: none;
    }
    .folio-pdf-body figure {
      margin: 16px 0;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #ffffff;
      overflow: hidden;
    }
    .folio-pdf-body figure > div {
      background: #f8fafc;
      padding: 8px;
      text-align: center;
    }
    .folio-pdf-body figure img {
      display: block;
      margin: 0 auto;
      max-width: 100%;
      max-height: 440px;
      width: auto;
      height: auto;
      object-fit: contain;
    }
    .folio-pdf-body figcaption {
      border-top: 1px solid #e2e8f0;
      padding: 7px 12px;
      font-size: 11.5px;
      color: #475569;
      background: #ffffff;
    }
    .folio-pdf-body hr {
      border: 0;
      border-top: 1px solid #e2e8f0;
      margin: 18px 0;
    }
    .folio-pdf-body a {
      color: #2563eb;
      text-decoration: underline;
    }
    .folio-pdf-body .katex-display {
      margin: 12px 0;
      padding: 6px 4px;
      overflow: visible;
      max-width: 100%;
    }
    .folio-pdf-body .katex {
      color: #0f172a;
    }
  `;
}

interface AtomicBlock {
  top: number;
  bottom: number;
  isHeading: boolean;
}

function collectAtomicBlocks(sheetEl: HTMLElement, maxPageHeightPx: number): AtomicBlock[] {
  const sheetRect = sheetEl.getBoundingClientRect();
  const blocks: AtomicBlock[] = [];

  const pushEl = (el: Element, isHeading = false) => {
    const r = el.getBoundingClientRect();
    const top = Math.max(0, Math.floor(r.top - sheetRect.top));
    const bottom = Math.max(top + 1, Math.ceil(r.bottom - sheetRect.top));
    blocks.push({ top, bottom, isHeading });
  };

  const header = sheetEl.querySelector('.folio-pdf-header');
  if (header) {
    pushEl(header, false);
  }

  const body = sheetEl.querySelector('.folio-pdf-body');
  if (!body) return blocks;

  for (const child of Array.from(body.children)) {
    const tag = child.tagName.toLowerCase();
    const height = child.getBoundingClientRect().height;

    if ((tag === 'ul' || tag === 'ol') && height > maxPageHeightPx * 0.35) {
      const items = Array.from(child.children).filter((c) => c.tagName.toLowerCase() === 'li');
      if (items.length > 0) {
        items.forEach((li) => pushEl(li, false));
        continue;
      }
    }

    if (tag === 'table' && height > maxPageHeightPx * 0.35) {
      const rows = Array.from(child.querySelectorAll('tr'));
      if (rows.length > 0) {
        rows.forEach((tr) => pushEl(tr, false));
        continue;
      }
    }

    const isHeading = tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4';
    pushEl(child, isHeading);
  }

  return blocks.sort((a, b) => a.top - b.top);
}

function computePageRanges(
  blocks: AtomicBlock[],
  totalHeightPx: number,
  maxPageHeightPx: number
): Array<{ startY: number; endY: number }> {
  if (totalHeightPx <= maxPageHeightPx || blocks.length === 0) {
    return [{ startY: 0, endY: Math.max(1, totalHeightPx) }];
  }

  const ranges: Array<{ startY: number; endY: number }> = [];
  let pageStart = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // If this block fits inside the current page, keep going
    if (block.bottom - pageStart <= maxPageHeightPx) {
      continue;
    }

    // Current block overflows the page
    if (block.top > pageStart + 24) {
      // Avoid stranding a heading alone at the bottom of a page
      const prev = i > 0 ? blocks[i - 1] : null;
      const breakY =
        prev && prev.isHeading && prev.top > pageStart + 24 ? prev.top : block.top;

      ranges.push({ startY: pageStart, endY: breakY });
      pageStart = breakY;
    }

    // If a single block itself is taller than an entire page, slice it cleanly
    while (block.bottom - pageStart > maxPageHeightPx) {
      const nextEnd = pageStart + maxPageHeightPx;
      ranges.push({ startY: pageStart, endY: nextEnd });
      pageStart = nextEnd;
    }
  }

  if (pageStart < totalHeightPx) {
    ranges.push({ startY: pageStart, endY: totalHeightPx });
  }

  return ranges;
}

export async function exportNoteAsPdf(
  note: Note,
  options: PdfExportOptions = {}
): Promise<void> {
  const { notebookName, pageSize = 'a4', includeMetadata = true } = options;
  const slug = slugify(note.title || 'folio-note');

  const resolvedAssets = await resolveNoteAssetsForPdf(note.assets);
  const bodyHtml = renderNoteToSanitizedHtml(
    note.markdown || '_Empty note_',
    resolvedAssets,
    {
      includeCopyButtons: false,
      wrapTables: false,
    }
  );

  // Page geometry in mm
  const pageWidthMm = pageSize === 'letter' ? 215.9 : 210;
  const pageHeightMm = pageSize === 'letter' ? 279.4 : 297;
  const marginX = 16;
  const marginTop = 15;
  const marginBottom = 18; // Leaves room for page footer
  const contentWidthMm = pageWidthMm - marginX * 2;
  const contentHeightMm = pageHeightMm - marginTop - marginBottom;

  const sheetWidthPx = 760;
  const pxPerMm = sheetWidthPx / contentWidthMm;
  const maxPageHeightPx = Math.floor(contentHeightMm * pxPerMm);

  const formattedDate = new Date(note.updatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-12000px';
  host.style.top = '0';
  host.style.width = `${sheetWidthPx}px`;
  host.style.background = '#ffffff';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-1';

  const styleEl = document.createElement('style');
  styleEl.textContent = buildPdfStylesheet();
  host.appendChild(styleEl);

  const sheet = document.createElement('div');
  sheet.className = 'folio-pdf-sheet';

  const metaParts = ['Folio Study Note', note.sourcePlatform];
  if (notebookName) metaParts.push(notebookName);
  metaParts.push(formattedDate);

  const headerHtml = includeMetadata
    ? `<header class="folio-pdf-header">
        <div class="folio-pdf-eyebrow">${escapeHtml(metaParts.join('  ·  '))}</div>
        <h1 class="folio-pdf-title">${escapeHtml(note.title || 'Untitled Note')}</h1>
        ${
          note.sourceUrl
            ? `<div class="folio-pdf-source-url">${escapeHtml(note.sourceUrl)}</div>`
            : ''
        }
      </header>`
    : `<header class="folio-pdf-header">
        <h1 class="folio-pdf-title">${escapeHtml(note.title || 'Untitled Note')}</h1>
      </header>`;

  sheet.innerHTML = `${headerHtml}<div class="folio-pdf-body">${bodyHtml}</div>`;

  // Replace native checkbox <input> elements with crisp CSS checkboxes for consistent PDF output
  sheet.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    const cb = input as HTMLInputElement;
    const li = cb.closest('li');
    if (li) li.classList.add('folio-pdf-task-item');
    const badge = document.createElement('span');
    badge.className = `folio-pdf-checkbox${cb.checked ? ' checked' : ''}`;
    badge.textContent = cb.checked ? '✓' : '';
    cb.replaceWith(badge);
  });

  // Resolve any remaining remote <img> URLs inside markdown body
  const imgs = Array.from(sheet.querySelectorAll('img'));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') || '';
      if (src && !src.startsWith('data:')) {
        const resolved = await resolveImageUrlToDataUrl(src);
        img.setAttribute('src', resolved);
      }
    })
  );

  host.appendChild(sheet);
  document.body.appendChild(host);

  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }

    // Wait for every image to load/decode before measuring heights & capturing
    await Promise.all(
      Array.from(sheet.querySelectorAll('img')).map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              if (typeof img.decode === 'function') {
                img.decode().then(() => resolve()).catch(() => resolve());
              } else {
                resolve();
              }
              return;
            }
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          })
      )
    );

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const totalHeightPx = Math.ceil(sheet.scrollHeight);
    const atomicBlocks = collectAtomicBlocks(sheet, maxPageHeightPx);
    const pageRanges = computePageRanges(atomicBlocks, totalHeightPx, maxPageHeightPx);

    const masterCanvas = await html2canvas(sheet, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      allowTaint: false,
      logging: false,
      width: sheetWidthPx,
      windowWidth: sheetWidthPx,
    });

    const scaleRatio = masterCanvas.width / sheetWidthPx;
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: pageSize,
      compress: true,
    });

    const footerLineY = pageHeightMm - 12.5;
    const footerTextY = pageHeightMm - 8.2;
    const footerTitle = (note.title || 'Untitled Note').slice(0, 68);

    pageRanges.forEach((range, idx) => {
      if (idx > 0) {
        pdf.addPage(pageSize, 'portrait');
      }

      const srcY = Math.max(0, Math.floor(range.startY * scaleRatio));
      const srcH = Math.max(
        1,
        Math.min(
          masterCanvas.height - srcY,
          Math.ceil((range.endY - range.startY) * scaleRatio)
        )
      );

      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = masterCanvas.width;
      pageCanvas.height = srcH;
      const ctx = pageCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(
          masterCanvas,
          0,
          srcY,
          masterCanvas.width,
          srcH,
          0,
          0,
          masterCanvas.width,
          srcH
        );

        const sliceHeightMm = (srcH / scaleRatio) / pxPerMm;
        const pageImgData = pageCanvas.toDataURL('image/png');
        pdf.addImage(
          pageImgData,
          'PNG',
          marginX,
          marginTop,
          contentWidthMm,
          sliceHeightMm,
          undefined,
          'FAST'
        );
      }

      // Crisp editorial footer
      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.25);
      pdf.line(marginX, footerLineY, pageWidthMm - marginX, footerLineY);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Folio  ·  ${footerTitle}`, marginX, footerTextY);
      pdf.text(
        `Page ${idx + 1} of ${pageRanges.length}`,
        pageWidthMm - marginX,
        footerTextY,
        { align: 'right' }
      );
    });

    pdf.save(`${slug}.pdf`);
  } finally {
    document.body.removeChild(host);
  }
}
