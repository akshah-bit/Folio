import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Crop, RotateCcw, X } from 'lucide-react';
import type { NoteAsset } from '../types/note';

interface ImageCropModalProps {
  asset: NoteAsset;
  onCancel: () => void;
  onApply: (croppedDataUrl: string, mimeType: string) => void;
}

interface CropRect {
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  w: number; // normalized 0..1
  h: number; // normalized 0..1
}

type AspectPreset = 'free' | '16:9' | '4:3' | '1:1';
type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

const MIN_SIZE = 0.08;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({ asset, onCancel, onApply }) => {
  const [crop, setCrop] = useState<CropRect>({ x: 0.06, y: 0.06, w: 0.88, h: 0.88 });
  const [preset, setPreset] = useState<AspectPreset>('free');
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragStateRef = useRef<{
    handle: DragHandle;
    startX: number;
    startY: number;
    initial: CropRect;
  } | null>(null);

  const applyPreset = (next: AspectPreset) => {
    setPreset(next);
    if (next === 'free') return;

    const ratio = next === '16:9' ? 16 / 9 : next === '4:3' ? 4 / 3 : 1;
    const imgRatio = naturalSize.w > 0 && naturalSize.h > 0 ? naturalSize.w / naturalSize.h : 1;
    const normRatio = ratio / imgRatio;

    let w = 0.82;
    let h = w / normRatio;
    if (h > 0.86) {
      h = 0.86;
      w = h * normRatio;
    }
    setCrop({
      x: (1 - w) / 2,
      y: (1 - h) / 2,
      w,
      h,
    });
  };

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      const stage = stageRef.current;
      if (!drag || !stage) return;

      const rect = stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dx = (e.clientX - drag.startX) / rect.width;
      const dy = (e.clientY - drag.startY) / rect.height;
      const init = drag.initial;

      if (drag.handle === 'move') {
        const nextX = clamp(init.x + dx, 0, 1 - init.w);
        const nextY = clamp(init.y + dy, 0, 1 - init.h);
        setCrop({ ...init, x: nextX, y: nextY });
        return;
      }

      let left = init.x;
      let top = init.y;
      let right = init.x + init.w;
      let bottom = init.y + init.h;

      if (drag.handle === 'nw' || drag.handle === 'sw') {
        left = clamp(init.x + dx, 0, right - MIN_SIZE);
      }
      if (drag.handle === 'ne' || drag.handle === 'se') {
        right = clamp(init.x + init.w + dx, left + MIN_SIZE, 1);
      }
      if (drag.handle === 'nw' || drag.handle === 'ne') {
        top = clamp(init.y + dy, 0, bottom - MIN_SIZE);
      }
      if (drag.handle === 'sw' || drag.handle === 'se') {
        bottom = clamp(init.y + init.h + dy, top + MIN_SIZE, 1);
      }

      setCrop({
        x: left,
        y: top,
        w: right - left,
        h: bottom - top,
      });
    };

    const onPointerUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  const startDrag = (handle: DragHandle, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragStateRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      initial: crop,
    };
  };

  const handleConfirmCrop = () => {
    const img = imgRef.current;
    if (!img || saving) return;
    setSaving(true);

    try {
      const natW = img.naturalWidth || img.width;
      const natH = img.naturalHeight || img.height;
      const sx = Math.max(0, Math.round(crop.x * natW));
      const sy = Math.max(0, Math.round(crop.y * natH));
      const sw = Math.max(16, Math.round(crop.w * natW));
      const sh = Math.max(16, Math.round(crop.h * natH));

      const maxOut = 1600;
      const scale = Math.min(1, maxOut / Math.max(sw, sh));
      const outW = Math.max(1, Math.round(sw * scale));
      const outH = Math.max(1, Math.round(sh * scale));

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setSaving(false);
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

      const targetMime = asset.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      let resultUrl = canvas.toDataURL(targetMime, 0.92);
      if (resultUrl.length > 780000) {
        resultUrl = canvas.toDataURL('image/jpeg', 0.85);
        onApply(resultUrl, 'image/jpeg');
      } else {
        onApply(resultUrl, targetMime);
      }
    } catch {
      setSaving(false);
    }
  };

  const cropPixelW = Math.max(1, Math.round(crop.w * naturalSize.w));
  const cropPixelH = Math.max(1, Math.round(crop.h * naturalSize.h));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm sm:p-6"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#111827]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <Crop className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <h3 className="truncate font-display text-sm font-semibold text-slate-900 dark:text-white">
              Crop Image
            </h3>
            {naturalSize.w > 0 && (
              <span className="font-mono text-[11px] tabular-nums text-slate-400">
                {cropPixelW} × {cropPixelH}px
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label="Cancel crop"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-hidden bg-slate-950/90 p-4 select-none">
          <div ref={stageRef} className="relative inline-block max-h-[58dvh] max-w-full touch-none">
            <img
              ref={imgRef}
              src={asset.dataUrl}
              alt={asset.caption || asset.name}
              crossOrigin="anonymous"
              onLoad={(e) => {
                const el = e.currentTarget;
                setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
              }}
              className="block max-h-[58dvh] max-w-full select-none object-contain pointer-events-none"
            />

            {/* Dimmed outer mask */}
            <div className="pointer-events-none absolute inset-0 bg-slate-950/55" />

            {/* Active Crop Box */}
            <div
              onPointerDown={(e) => startDrag('move', e)}
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.w * 100}%`,
                height: `${crop.h * 100}%`,
              }}
              className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(2,6,23,0.45)]"
            >
              {/* Rule-of-thirds subtle grid lines */}
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-35">
                <div className="border-r border-b border-white/60" />
                <div className="border-r border-b border-white/60" />
                <div className="border-b border-white/60" />
                <div className="border-r border-b border-white/60" />
                <div className="border-r border-b border-white/60" />
                <div className="border-b border-white/60" />
                <div className="border-r border-white/60" />
                <div className="border-r border-white/60" />
                <div />
              </div>

              {/* Corner Drag Handles (44px hit targets via invisible padding) */}
              {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
                const posClass =
                  corner === 'nw'
                    ? '-top-3 -left-3 cursor-nwse-resize'
                    : corner === 'ne'
                      ? '-top-3 -right-3 cursor-nesw-resize'
                      : corner === 'sw'
                        ? '-bottom-3 -left-3 cursor-nesw-resize'
                        : '-bottom-3 -right-3 cursor-nwse-resize';
                return (
                  <button
                    key={corner}
                    type="button"
                    aria-label={`Resize ${corner} corner`}
                    onPointerDown={(e) => startDrag(corner, e)}
                    className={`absolute flex h-7 w-7 items-center justify-center ${posClass}`}
                  >
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-blue-600 bg-white shadow-sm" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
            {(['free', '16:9', '4:3', '1:1'] as AspectPreset[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => applyPreset(opt)}
                className={`min-h-[32px] rounded-md px-2.5 text-xs font-medium capitalize transition-colors ${
                  preset === opt
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {opt === 'free' ? 'Free' : opt}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPreset('free');
                setCrop({ x: 0, y: 0, w: 1, h: 1 });
              }}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleConfirmCrop}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white transition-all active:scale-95 hover:bg-blue-700 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              Apply Crop
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
