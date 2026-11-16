import { marked } from 'marked';
import katex from 'katex';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import type { NoteAsset } from '../types/note';

interface MathToken {
  placeholder: string;
  tex: string;
  display: boolean;
}

export function stashMathExpressions(src: string): { text: string; tokens: MathToken[] } {
  const tokens: MathToken[] = [];
  const codeBlocks: Array<{ placeholder: string; content: string }> = [];

  // Temporarily protect fenced code blocks and inline code so $ inside code is untouched
  let protectedText = src.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const placeholder = `@@CODE_STASH_${codeBlocks.length}@@`;
    codeBlocks.push({ placeholder, content: match });
    return placeholder;
  });

  // Display math $$...$$
  protectedText = protectedText.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => {
    const placeholder = `@@MATH_BLOCK_${tokens.length}@@`;
    tokens.push({ placeholder, tex: tex.trim(), display: true });
    return `\n\n${placeholder}\n\n`;
  });

  // Inline math $...$ (avoid matching currency like $50 or $ 10)
  protectedText = protectedText.replace(/(?<!\\)\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (_m, tex: string) => {
    if (/^\d+(?:[.,]\d+)?$/.test(tex.trim())) {
      return `$${tex}$`;
    }
    const placeholder = `@@MATH_INLINE_${tokens.length}@@`;
    tokens.push({ placeholder, tex: tex.trim(), display: false });
    return placeholder;
  });

  // Restore code blocks
  for (const cb of codeBlocks) {
    protectedText = protectedText.replace(cb.placeholder, () => cb.content);
  }

  return { text: protectedText, tokens };
}

function renderKatexHtml(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'htmlAndMathml',
    });
  } catch {
    return `<code>${tex.replace(/</g, '&lt;')}</code>`;
  }
}

export interface RenderNoteHtmlOptions {
  includeCopyButtons?: boolean;
  wrapTables?: boolean;
}

export function renderNoteToSanitizedHtml(
  markdown: string,
  assets: Record<string, NoteAsset>,
  options: RenderNoteHtmlOptions = {}
): string {
  const { includeCopyButtons = true, wrapTables = true } = options;
  const { text: stashedMd, tokens } = stashMathExpressions(markdown || '');

  const renderer = new marked.Renderer();
  renderer.code = ({ text, lang }) => {
    const language = (lang || '').trim().toLowerCase();
    let highlighted = '';
    try {
      if (language && hljs.getLanguage(language)) {
        highlighted = hljs.highlight(text, { language }).value;
      } else {
        highlighted = hljs.highlightAuto(text).value;
      }
    } catch {
      highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    const langLabel = language || 'code';
    const copyBtnHtml = includeCopyButtons
      ? `<button type="button" data-copy-code="true" class="inline-flex min-h-[32px] items-center gap-1 rounded px-2.5 py-0.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white">Copy</button>`
      : '';

    return `<div class="folio-code-wrap my-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-[#111827]"><div class="folio-code-header flex items-center justify-between border-b border-slate-200 px-3.5 py-1.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400"><span class="font-mono">${langLabel}</span>${copyBtnHtml}</div><pre class="no-scrollbar overflow-x-auto p-3.5 text-[13px] leading-relaxed"><code class="hljs">${highlighted}</code></pre></div>`;
  };

  renderer.image = ({ href, title, text }) => {
    const rawHref = href || '';
    let resolvedSrc = rawHref;
    let caption = text || title || '';

    let assetAttr = '';
    if (rawHref.startsWith('folio-asset://')) {
      const assetId = rawHref.replace('folio-asset://', '');
      const asset = assets[assetId];
      if (asset) {
        resolvedSrc = asset.dataUrl;
        caption = asset.caption || caption || asset.name;
        assetAttr = `data-asset-id="${assetId.replace(/"/g, '&quot;')}"`;
      } else {
        return `<div class="my-4 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">Missing embedded image (${assetId})</div>`;
      }
    }

    const safeAlt = (caption || 'Embedded note image').replace(/"/g, '&quot;');
    return `<figure class="my-5 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]"><div class="relative bg-slate-50 dark:bg-slate-950/60"><img src="${resolvedSrc}" alt="${safeAlt}" ${assetAttr} referrerpolicy="no-referrer" data-zoomable="true" class="mx-auto max-h-[460px] w-auto cursor-zoom-in object-contain p-2" /></div>${caption ? `<figcaption class="border-t border-slate-200 px-3.5 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">${caption.replace(/</g, '&lt;')}</figcaption>` : ''}</figure>`;
  };

  let html = marked.parse(stashedMd, {
    renderer,
    gfm: true,
    breaks: false,
  }) as string;

  if (wrapTables) {
    html = html
      .replace(/<table>/g, '<div class="no-scrollbar overflow-x-auto"><table>')
      .replace(/<\/table>/g, '</table></div>');
  }

  for (const token of tokens) {
    const renderedMath = renderKatexHtml(token.tex, token.display);
    html = html.replace(token.placeholder, () => renderedMath);
  }

  return DOMPurify.sanitize(html, {
    ADD_TAGS: [
      'math',
      'semantics',
      'mrow',
      'mi',
      'mo',
      'mn',
      'msup',
      'msub',
      'mfrac',
      'msqrt',
      'mtext',
      'annotation',
      'figure',
      'figcaption',
      'button',
      'input',
    ],
    ADD_ATTR: [
      'encoding',
      'xmlns',
      'display',
      'aria-hidden',
      'data-copy-code',
      'data-zoomable',
      'referrerpolicy',
      'type',
      'checked',
      'disabled',
    ],
    ALLOW_DATA_ATTR: true,
  });
}
