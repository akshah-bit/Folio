import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, Crop, ImageOff, Maximize2, X } from 'lucide-react';
import type { NoteAsset } from '../types/note';
import { renderNoteToSanitizedHtml } from '../lib/markdownRenderer';

interface RichNoteRendererProps {
  markdown: string;
  assets: Record<string, NoteAsset>;
  onToggleCheckbox?: (lineIndex: number, checked: boolean) => void;
  onRenderedHtmlChange?: (html: string) => void;
  onRequestCropAsset?: (assetId: string) => void;
}

export const RichNoteRenderer: React.FC<RichNoteRendererProps> = ({
  markdown,
  assets,
  onToggleCheckbox,
  onRenderedHtmlChange,
  onRequestCropAsset,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string; assetId?: string } | null>(
    null
  );
  const [copiedCodeIdx, setCopiedCodeIdx] = useState<number | null>(null);

  const sanitizedHtml = useMemo(
    () =>
      renderNoteToSanitizedHtml(markdown || '', assets, {
        includeCopyButtons: true,
        wrapTables: true,
      }),
    [markdown, assets]
  );

  useEffect(() => {
    onRenderedHtmlChange?.(sanitizedHtml);
  }, [sanitizedHtml, onRenderedHtmlChange]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    // Attach resilience handler to every rendered image (Zero-Broken-Image Policy)
    const imgs = Array.from(root.querySelectorAll('img'));
    const cleanups: Array<() => void> = [];

    imgs.forEach((img) => {
      const onErr = () => {
        const parent = img.parentElement;
        if (!parent) return;
        const alt = img.getAttribute('alt') || 'Image unavailable';
        const fallback = document.createElement('div');
        fallback.className =
          'flex flex-col items-center justify-center gap-2 py-8 px-4 text-center text-xs text-slate-500 dark:text-slate-400';
        fallback.textContent = `Unable to load image: ${alt}`;
        img.replaceWith(fallback);
      };
      img.addEventListener('error', onErr);
      cleanups.push(() => img.removeEventListener('error', onErr));
    });

    // Attach copy code & image zoom handlers
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const copyBtn = target.closest('[data-copy-code="true"]') as HTMLButtonElement | null;
      if (copyBtn) {
        const wrap = copyBtn.closest('.folio-code-wrap');
        const codeEl = wrap?.querySelector('pre code');
        if (codeEl) {
          navigator.clipboard.writeText(codeEl.textContent || '');
          const allBtns = Array.from(root.querySelectorAll('[data-copy-code="true"]'));
          const idx = allBtns.indexOf(copyBtn);
          setCopiedCodeIdx(idx);
          copyBtn.textContent = 'Copied';
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
            setCopiedCodeIdx(null);
          }, 1500);
        }
        return;
      }

      const img = target.closest('img[data-zoomable="true"]') as HTMLImageElement | null;
      if (img) {
        setZoomedImage({
          src: img.src,
          alt: img.alt || 'Image preview',
          assetId: img.getAttribute('data-asset-id') || undefined,
        });
      }
    };

    root.addEventListener('click', handleClick);

    // Enable interactive checkboxes if callback is provided
    const checkboxes = Array.from(root.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    checkboxes.forEach((cb, idx) => {
      cb.disabled = !onToggleCheckbox;
      if (onToggleCheckbox) {
        const onChange = () => {
          onToggleCheckbox(idx, cb.checked);
        };
        cb.addEventListener('change', onChange);
        cleanups.push(() => cb.removeEventListener('change', onChange));
      }
    });

    return () => {
      root.removeEventListener('click', handleClick);
      cleanups.forEach((fn) => fn());
    };
  }, [sanitizedHtml, onToggleCheckbox]);

  void copiedCodeIdx;

  return (
    <>
      <div
        ref={containerRef}
        className="folio-prose max-w-none break-words"
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />

      <AnimatePresence>
        {zoomedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md sm:p-6"
            onClick={() => setZoomedImage(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="relative max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-700 bg-white p-3 dark:bg-slate-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between gap-4 border-b border-slate-200 pb-2 dark:border-slate-800">
                <span className="truncate text-xs font-medium text-slate-600 dark:text-slate-300">
                  {zoomedImage.alt}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {zoomedImage.assetId && onRequestCropAsset && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetId = zoomedImage.assetId!;
                        setZoomedImage(null);
                        onRequestCropAsset(targetId);
                      }}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 active:scale-95 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                    >
                      <Crop className="h-3.5 w-3.5" />
                      Crop
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setZoomedImage(null)}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 active:scale-95 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
                    aria-label="Close image preview"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <img
                src={zoomedImage.src}
                alt={zoomedImage.alt}
                referrerPolicy="no-referrer"
                className="mx-auto max-h-[75vh] w-auto rounded-lg object-contain"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

// Suppress unused icon warnings while keeping semantic icons available if needed
export { Check, Copy, ImageOff, Maximize2 };
