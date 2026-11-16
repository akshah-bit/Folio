import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, FolderArchive } from 'lucide-react';
import { downloadExtensionZip, getExtensionSourceFiles } from '../lib/extensionPackager';

export const ExtensionBuilderView: React.FC = () => {
  const [targetUrl, setTargetUrl] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
  );
  const files = useMemo(() => getExtensionSourceFiles(targetUrl), [targetUrl]);
  const [selectedPath, setSelectedPath] = useState<string>('manifest.json');
  const [downloading, setDownloading] = useState(false);
  const [copiedFile, setCopiedFile] = useState(false);

  const activeFile = files.find((f) => f.path === selectedPath) || files[0];

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadExtensionZip(targetUrl);
    } finally {
      setDownloading(false);
    }
  };

  const handleCopyFile = () => {
    navigator.clipboard.writeText(activeFile.content);
    setCopiedFile(true);
    setTimeout(() => setCopiedFile(false), 1500);
  };

  return (
    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 pb-8 sm:px-6 sm:py-8">
      <div className="mb-8 flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 dark:border-slate-800 md:flex-row md:items-end">
        <div className="max-w-2xl">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">
            Manifest V3 Chrome Extension
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            A ready-to-load Chromium extension for Chrome, Edge, Brave, and Arc on Windows and
            macOS. It hydrates expiring AI image URLs to base64 via the background worker and
            extracts exact TeX math annotations before writing to your clipboard or opening Folio.
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white transition-all active:scale-[0.98] hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0 md:min-h-[38px] md:w-auto md:rounded-lg"
        >
          <Download className="h-4 w-4" />
          {downloading ? 'Packaging ZIP...' : 'Download Extension (.zip)'}
        </button>
      </div>

      {/* Configuration & 4-Step Load Unpacked Guide */}
      <div className="mb-8 grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827] lg:col-span-5 lg:rounded-xl">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Extension Target Configuration
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            When you click &ldquo;Send Directly to Folio&rdquo; inside the extension popup, it opens
            this workspace URL with the captured payload attached.
          </p>

          <label className="mt-4 block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Folio Workspace URL
            </span>
            <input
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 lg:min-h-[36px] lg:rounded-lg"
            />
          </label>

          <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Supported AI Platforms
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              ChatGPT · Claude · Google Gemini · Perplexity · DeepSeek
            </p>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Shortcut: <kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[11px] dark:border-slate-700">Alt+Shift+S</kbd> (Win) /{' '}
              <kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[11px] dark:border-slate-700">Cmd+Shift+S</kbd> (Mac)
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827] lg:col-span-7 lg:rounded-xl">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Install in Chrome / Edge / Brave in 4 Steps
          </h2>
          <ol className="mt-3 space-y-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <li>
              <span className="font-mono font-semibold text-slate-900 dark:text-white">01.</span>{' '}
              Click <strong>Download Extension (.zip)</strong> above and extract the folder to a
              permanent directory (e.g. <span className="font-mono">Documents/FolioClipper</span>).
            </li>
            <li>
              <span className="font-mono font-semibold text-slate-900 dark:text-white">02.</span>{' '}
              Open <span className="font-mono">chrome://extensions</span> (or{' '}
              <span className="font-mono">edge://extensions</span>) in a new browser tab.
            </li>
            <li>
              <span className="font-mono font-semibold text-slate-900 dark:text-white">03.</span>{' '}
              Toggle <strong>Developer mode</strong> on in the upper-right corner.
            </li>
            <li>
              <span className="font-mono font-semibold text-slate-900 dark:text-white">04.</span>{' '}
              Click <strong>Load unpacked</strong>, select the extracted folder, and pin{' '}
              <strong>Folio AI Note Clipper</strong> to your toolbar.
            </li>
          </ol>
        </div>
      </div>

      {/* Live Extension Source Code Inspector */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0B0F17] lg:rounded-xl">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          <div className="border-b border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-[#111827] lg:col-span-3 lg:border-b-0 lg:border-r">
            <div className="mb-2 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Package Files ({files.length})
            </div>
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
              {files.map((file) => {
                const active = file.path === activeFile.path;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedPath(file.path)}
                    className={`flex min-h-[40px] shrink-0 items-center justify-between rounded-lg px-3 py-2 text-left font-mono text-xs transition-all active:scale-[0.98] lg:min-h-[34px] lg:rounded-md lg:px-2.5 ${
                      active
                        ? 'bg-white font-semibold text-blue-600 shadow-xs ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-blue-400 dark:ring-slate-700'
                        : 'text-slate-700 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-white'
                    }`}
                  >
                    <span className="truncate whitespace-nowrap">{file.path}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-9">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-5">
              <div className="min-w-0">
                <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {activeFile.path}
                </div>
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {activeFile.description}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyFile}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-all active:scale-95 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white whitespace-nowrap shrink-0 lg:min-h-[32px] lg:rounded-md"
              >
                {copiedFile ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedFile ? 'Copied' : 'Copy File'}
              </button>
            </div>
            <pre className="no-scrollbar max-h-[440px] overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200 sm:p-5">
              {activeFile.content}
            </pre>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export { FolderArchive };
