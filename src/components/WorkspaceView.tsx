import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bold,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  Code2,
  Copy,
  Crop,
  Download,
  FileDown,
  FileText,
  FolderPlus,
  Heading2,
  ImagePlus,
  Loader2,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Printer,
  Search,
  Sigma,
  Table2,
  Trash2,
  Upload,
} from 'lucide-react';
import type { AiPlatform, EditorMode, Note, Notebook, NoteAsset } from '../types/note';
import {
  extractClipboardImages,
  fileToDataUrl,
  processClipboardPayload,
} from '../lib/aiClipperEngine';
import {
  buildPortableMarkdown,
  exportNoteAsMarkdownZip,
  exportNoteAsPortableHtml,
  exportWorkspaceBackupJson,
} from '../lib/noteExporter';
import { RichNoteRenderer } from './RichNoteRenderer';
import { ImageCropModal } from './ImageCropModal';

export interface CloudSyncUserInfo {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

interface WorkspaceViewProps {
  notes: Note[];
  notebooks: Notebook[];
  activeNoteId: string;
  autoEditSignal?: number;
  mobileScreen: 'list' | 'note';
  isOnline: boolean;
  user: CloudSyncUserInfo | null;
  syncState: 'local' | 'syncing' | 'synced' | 'offline';
  onSignIn: () => void;
  onSignOut: () => void;
  onMobileScreenChange: (screen: 'list' | 'note') => void;
  onSelectNote: (id: string) => void;
  onUpdateNote: (updated: Note) => void;
  onDeleteNote: (id: string) => void;
  onCreateNote: (notebookId?: string) => void;
  onCreateNotebook: (name: string) => void;
  onImportNotes: (imported: Note[]) => void;
}

const PLATFORMS: AiPlatform[] = [
  'ChatGPT',
  'Claude',
  'Gemini',
  'Perplexity',
  'DeepSeek',
  'Web',
  'Manual',
];

function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function estimateReadMinutes(md: string): number {
  const words = md.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function extractExcerpt(md: string): string {
  const lines = md.split('\n');
  for (const line of lines) {
    const clean = line
      .trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      .replace(/[`*_>$]/g, '')
      .trim();
    if (clean.length > 0 && !clean.startsWith('|') && !clean.startsWith('---')) {
      return clean;
    }
  }
  return 'Empty note — paste from any AI chat';
}

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  notes,
  notebooks,
  activeNoteId,
  autoEditSignal = 0,
  mobileScreen,
  isOnline,
  user,
  syncState,
  onSignIn,
  onSignOut,
  onMobileScreenChange,
  onSelectNote,
  onUpdateNote,
  onDeleteNote,
  onCreateNote,
  onCreateNotebook,
  onImportNotes,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('read');
  const [newNotebookOpen, setNewNotebookOpen] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [toastState, setToastState] = useState<{ msg: string; cropAssetId?: string } | null>(null);
  const [cropAssetId, setCropAssetId] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [lastRenderedHtml, setLastRenderedHtml] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (msg: string, cropId?: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastState({ msg, cropAssetId: cropId });
    toastTimerRef.current = window.setTimeout(
      () => setToastState(null),
      cropId ? 4200 : 2400
    );
  };

  const handleExportPdf = async (note: Note) => {
    if (exportingPdf) return;
    setExportMenuOpen(false);
    setExportingPdf(true);
    try {
      const { exportNoteAsPdf } = await import('../lib/pdfExporter');
      const notebookName = notebooks.find((nb) => nb.id === note.notebookId)?.name;
      await exportNoteAsPdf(note, {
        notebookName,
        pageSize: 'a4',
        includeMetadata: true,
      });
      showToast('Exported formatted PDF');
    } catch (err) {
      console.error('PDF export failed:', err);
      showToast('PDF export failed — try Print');
    } finally {
      setExportingPdf(false);
    }
  };

  // When user explicitly creates a new note, switch straight to Edit mode so normal note typing starts immediately
  useEffect(() => {
    if (autoEditSignal > 0) {
      setEditorMode('source');
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [autoEditSignal]);

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notes
      .filter((n) => (selectedNotebookId === 'all' ? true : n.notebookId === selectedNotebookId))
      .filter((n) => {
        if (!q) return true;
        return (
          n.title.toLowerCase().includes(q) ||
          n.markdown.toLowerCase().includes(q) ||
          n.sourcePlatform.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
  }, [notes, selectedNotebookId, searchQuery]);

  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeNoteId) || filteredNotes[0] || null,
    [notes, activeNoteId, filteredNotes]
  );

  // Auto-size Edit mode textarea so it expands smoothly without a nested scrollbar
  useEffect(() => {
    if (editorMode !== 'source') return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(360, ta.scrollHeight)}px`;
  }, [activeNote?.id, activeNote?.markdown, editorMode]);

  const notebookCounts = useMemo(() => {
    const counts: Record<string, number> = { all: notes.length };
    for (const n of notes) {
      counts[n.notebookId] = (counts[n.notebookId] || 0) + 1;
    }
    return counts;
  }, [notes]);

  const insertTextAtCursor = (
    note: Note,
    snippet: string,
    extraAssets?: Record<string, NoteAsset>,
    detectedPlatform?: AiPlatform,
    suggestedTitle?: string
  ) => {
    const ta = textareaRef.current;
    const mergedAssets = extraAssets ? { ...note.assets, ...extraAssets } : note.assets;
    const nextSource =
      note.sourcePlatform === 'Manual' && detectedPlatform && detectedPlatform !== 'Manual'
        ? detectedPlatform
        : note.sourcePlatform;

    const isUntitled = !note.title.trim() || note.title.trim() === 'Untitled Note';
    const nextTitle = isUntitled && suggestedTitle ? suggestedTitle : note.title;

    if (!ta) {
      const nextBody =
        note.markdown.trim().length === 0
          ? snippet
          : `${note.markdown.trimEnd()}\n\n${snippet}`.trim();
      onUpdateNote({
        ...note,
        title: nextTitle,
        sourcePlatform: nextSource,
        markdown: nextBody,
        assets: mergedAssets,
        updatedAt: Date.now(),
      });
      return;
    }

    const start = ta.selectionStart ?? note.markdown.length;
    const end = ta.selectionEnd ?? note.markdown.length;
    const nextMd = `${note.markdown.slice(0, start)}${snippet}${note.markdown.slice(end)}`;
    onUpdateNote({
      ...note,
      title: nextTitle,
      sourcePlatform: nextSource,
      markdown: nextMd,
      assets: mergedAssets,
      updatedAt: Date.now(),
    });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + snippet.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const wrapSelection = (before: string, after: string, placeholder: string) => {
    if (!activeNote) return;
    const ta = textareaRef.current;
    if (!ta) {
      insertTextAtCursor(activeNote, `${before}${placeholder}${after}`);
      return;
    }
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = activeNote.markdown.slice(start, end) || placeholder;
    const nextMd = `${activeNote.markdown.slice(0, start)}${before}${selected}${after}${activeNote.markdown.slice(end)}`;
    onUpdateNote({
      ...activeNote,
      markdown: nextMd,
      updatedAt: Date.now(),
    });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const applyClipboardData = async (dt: DataTransfer, note: Note) => {
    const html = dt.getData('text/html') || '';
    const plain = dt.getData('text/plain') || '';
    const imageBlobs = extractClipboardImages(dt);

    if (!html && !plain && imageBlobs.length === 0) return;

    const converted = await processClipboardPayload(html, plain, imageBlobs);
    insertTextAtCursor(
      note,
      converted.markdown,
      converted.assets,
      converted.stats.platformDetected,
      converted.suggestedTitle
    );

    const assetKeys = Object.keys(converted.assets);
    const imgCount = assetKeys.length;
    const firstCropCandidate = assetKeys.find(
      (k) =>
        converted.assets[k]?.dataUrl.startsWith('data:image/') &&
        !converted.assets[k]?.dataUrl.startsWith('data:image/svg')
    );
    showToast(
      imgCount > 0
        ? `Pasted with ${imgCount} image${imgCount > 1 ? 's' : ''}`
        : 'Pasted formatted note',
      firstCropCandidate
    );
  };

  useEffect(() => {
    const onWindowPaste = (e: ClipboardEvent) => {
      if (!activeNote) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }
      if (!e.clipboardData) return;
      e.preventDefault();
      void applyClipboardData(e.clipboardData, activeNote);
    };

    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [activeNote]);

  const handleTextareaPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!activeNote) return;
    const dt = e.clipboardData;
    const html = dt.getData('text/html') || '';
    const imageBlobs = extractClipboardImages(dt);

    const hasRichHtml =
      html.trim().length > 0 &&
      /(katex|<table|<pre|<h[1-6]|<ul|<ol|<img|<svg|data-message|<strong|<b|<p)/i.test(html);

    if (!hasRichHtml && imageBlobs.length === 0) {
      return;
    }

    e.preventDefault();
    await applyClipboardData(dt, activeNote);
  };

  const handleAttachImages = async (files: FileList | null) => {
    if (!files || files.length === 0 || !activeNote) return;
    const nextAssets: Record<string, NoteAsset> = {};
    const snippets: string[] = [];

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await fileToDataUrl(file);
      const id = `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      nextAssets[id] = {
        id,
        name: file.name,
        mimeType: file.type,
        dataUrl,
        caption: file.name.replace(/\.[^.]+$/, ''),
        createdAt: Date.now(),
      };
      snippets.push(`![${file.name.replace(/\.[^.]+$/, '')}](folio-asset://${id})`);
    }

    if (snippets.length > 0) {
      insertTextAtCursor(activeNote, `\n${snippets.join('\n\n')}\n`, nextAssets);
      const firstId = Object.keys(nextAssets)[0];
      showToast(`Added ${snippets.length} image${snippets.length > 1 ? 's' : ''}`, firstId);
    }
  };

  const handleToggleCheckbox = (checkboxIdx: number, checked: boolean) => {
    if (!activeNote) return;
    let seen = 0;
    const updatedMd = activeNote.markdown.replace(/^(\s*[-*]\s+\[)([ xX])(\]\s+)/gm, (full, p1, _mark, p3) => {
      if (seen === checkboxIdx) {
        seen += 1;
        return `${p1}${checked ? 'x' : ' '}${p3}`;
      }
      seen += 1;
      return full;
    });
    onUpdateNote({ ...activeNote, markdown: updatedMd, updatedAt: Date.now() });
  };

  const handleCreateNotebookSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newNotebookName.trim();
    if (!trimmed) return;
    onCreateNotebook(trimmed);
    setNewNotebookName('');
    setNewNotebookOpen(false);
  };

  const handleImportBackup = async (files: FileList | null) => {
    if (!files || !files[0]) return;
    try {
      const text = await files[0].text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.notes) ? parsed.notes : [];
      if (list.length > 0) {
        onImportNotes(list);
        showToast(`Imported ${list.length} note${list.length > 1 ? 's' : ''}`);
      }
    } catch {
      showToast('Invalid JSON backup file');
    }
  };

  const assetEntries = activeNote ? Object.values(activeNote.assets) : [];

  const handleSelectNoteItem = (id: string) => {
    onSelectNote(id);
    onMobileScreenChange('note');
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      {/* Sidebar / Mobile List View */}
      {(sidebarOpen || mobileScreen === 'list') && (
        <aside
          className={`no-print ${
            mobileScreen === 'list' ? 'flex' : 'hidden'
          } ${
            sidebarOpen ? 'lg:flex' : 'lg:hidden'
          } min-h-0 flex-1 w-full shrink-0 flex-col overflow-hidden border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-[#0F1520] lg:flex-none lg:w-[290px] lg:border-r`}
        >
          <div className="shrink-0 p-4 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notes, math, code..."
                aria-label="Search notes"
                className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-600 dark:border-slate-800 dark:bg-[#0B0F17] dark:text-slate-100 lg:min-h-[36px] lg:rounded-lg lg:text-xs"
              />
            </div>

            <div className="mt-3.5">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400">
                  Notebooks
                </span>
                <button
                  type="button"
                  onClick={() => setNewNotebookOpen((v) => !v)}
                  className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 active:scale-95 hover:bg-slate-200/70 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white lg:min-h-[26px] lg:min-w-[26px]"
                  title="New notebook"
                  aria-label="Create notebook"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </button>
              </div>

              {newNotebookOpen && (
                <form onSubmit={handleCreateNotebookSubmit} className="mb-2.5 flex gap-1.5">
                  <input
                    type="text"
                    value={newNotebookName}
                    onChange={(e) => setNewNotebookName(e.target.value)}
                    placeholder="Notebook name"
                    autoFocus
                    className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 lg:min-h-[32px]"
                  />
                  <button
                    type="submit"
                    className="min-h-[40px] rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white active:scale-95 hover:bg-blue-700 lg:min-h-[32px]"
                  >
                    Add
                  </button>
                </form>
              )}

              <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
                <button
                  type="button"
                  onClick={() => setSelectedNotebookId('all')}
                  className={`flex min-h-[38px] shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs transition-all active:scale-[0.98] lg:min-h-[32px] lg:rounded-md lg:px-2.5 ${
                    selectedNotebookId === 'all'
                      ? 'bg-white font-semibold text-slate-900 shadow-2xs ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-white dark:ring-slate-700'
                      : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                  }`}
                >
                  <span className="truncate whitespace-nowrap">All Notes</span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-400">
                    {notebookCounts.all || 0}
                  </span>
                </button>
                {notebooks.map((nb) => (
                  <button
                    key={nb.id}
                    type="button"
                    onClick={() => setSelectedNotebookId(nb.id)}
                    className={`flex min-h-[38px] shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs transition-all active:scale-[0.98] lg:min-h-[32px] lg:rounded-md lg:px-2.5 ${
                      selectedNotebookId === nb.id
                        ? 'bg-white font-semibold text-slate-900 shadow-2xs ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-white dark:ring-slate-700'
                        : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                    }`}
                  >
                    <span className="truncate whitespace-nowrap">{nb.name}</span>
                    <span className="font-mono text-[11px] tabular-nums text-slate-400">
                      {notebookCounts[nb.id] || 0}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto border-t border-slate-200 px-3 py-2.5 dark:border-slate-800">
            {filteredNotes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No notes match your search.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 lg:gap-1">
                {filteredNotes.map((note) => {
                  const isActive = activeNote?.id === note.id;
                  const imgCount = Object.keys(note.assets).length;
                  const excerpt = extractExcerpt(note.markdown);
                  return (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => handleSelectNoteItem(note.id)}
                      className={`group flex min-h-[68px] items-center justify-between gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-all active:scale-[0.99] lg:min-h-0 lg:rounded-lg lg:px-3 ${
                        isActive
                          ? 'border-slate-300 bg-white shadow-2xs dark:border-slate-700 dark:bg-[#0B0F17]'
                          : 'border-slate-200/60 bg-white/70 hover:bg-white dark:border-slate-800/60 dark:bg-[#0B0F17]/50 dark:hover:bg-slate-800/60 lg:border-transparent lg:bg-transparent lg:hover:bg-white/80 dark:lg:bg-transparent dark:lg:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {note.pinned && (
                            <Pin className="h-3 w-3 shrink-0 text-blue-600 dark:text-blue-400" />
                          )}
                          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100 lg:text-[13px]">
                            {note.title || 'Untitled Note'}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400 lg:text-[11.5px]">
                          {excerpt}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400 tabular-nums dark:text-slate-500">
                          <span>{note.sourcePlatform}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatShortDate(note.updatedAt)}</span>
                          {imgCount > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {imgCount} img{imgCount > 1 ? 's' : ''}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600 lg:hidden" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cloud Sync & Local Backup Footer */}
          <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 px-4 py-2.5 text-xs dark:border-slate-800">
            {user ? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {isOnline ? (
                    <Cloud className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <CloudOff className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800 dark:text-slate-200">
                      {user.displayName || user.email || 'Google Sync'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {!isOnline
                        ? 'Offline · Cached locally'
                        : syncState === 'syncing'
                          ? 'Syncing notes...'
                          : 'Synced across devices'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-lg px-2 text-slate-500 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                  title="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                className="flex min-h-[38px] w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left font-medium text-slate-700 transition-colors active:scale-[0.99] hover:border-blue-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-[#0B0F17] dark:text-slate-200 dark:hover:border-blue-800 dark:hover:bg-slate-800/60 dark:hover:text-white lg:min-h-[32px]"
              >
                <span className="flex items-center gap-1.5">
                  <Cloud className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  Sync across devices
                </span>
                <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                  Sign in
                </span>
              </button>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-slate-200/70 pt-1.5 dark:border-slate-800/70">
              <button
                type="button"
                onClick={() => exportWorkspaceBackupJson(notes)}
                className="inline-flex min-h-[34px] items-center gap-1.5 text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white lg:min-h-[26px]"
              >
                <Download className="h-3.5 w-3.5" />
                Backup
              </button>
              <button
                type="button"
                onClick={() => backupInputRef.current?.click()}
                className="inline-flex min-h-[34px] items-center gap-1.5 text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white lg:min-h-[26px]"
              >
                <Upload className="h-3.5 w-3.5" />
                Restore
              </button>
              <input
                ref={backupInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => handleImportBackup(e.target.files)}
              />
            </div>
          </div>
        </aside>
      )}

      {/* Main Note Canvas */}
      <main
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleAttachImages(e.dataTransfer.files);
        }}
        className={`${
          mobileScreen === 'note' ? 'flex' : 'hidden lg:flex'
        } min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white transition-colors dark:bg-[#0B0F17] ${
          dragOver ? 'ring-2 ring-inset ring-blue-500/70' : ''
        }`}
      >
        {!activeNote ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <FileText className="h-10 w-10 text-slate-300 dark:text-slate-700" />
            <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
              No note selected
            </h2>
            <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
              Create a note and press Ctrl+V (or Cmd+V) directly to paste text and images from any AI chat.
            </p>
            <button
              type="button"
              onClick={() => onCreateNote(notebooks[0]?.id)}
              className="mt-4 min-h-[44px] rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white active:scale-[0.98] hover:bg-blue-700"
            >
              Create Note
            </button>
          </div>
        ) : (
          <motion.div
            key={activeNote.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {/* Minimalist Frosted Action Toolbar */}
            <div className="no-print z-20 flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-white/85 px-4 py-2 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#0B0F17]/85 sm:px-6">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onMobileScreenChange('list')}
                  className="inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-700 active:scale-95 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 lg:hidden"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Notes
                </button>

                <button
                  type="button"
                  onClick={() => setSidebarOpen((v) => !v)}
                  className="hidden h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white lg:inline-flex"
                  title={sidebarOpen ? 'Focus mode (hide sidebar)' : 'Show sidebar'}
                  aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="h-4 w-4" />
                  ) : (
                    <PanelLeftOpen className="h-4 w-4" />
                  )}
                </button>

                <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-900">
                  {([
                    { id: 'read', label: 'Read', hideMobile: false },
                    { id: 'split', label: 'Split', hideMobile: true },
                    { id: 'source', label: 'Edit', hideMobile: false },
                  ] as Array<{ id: EditorMode; label: string; hideMobile: boolean }>).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setEditorMode(mode.id)}
                      className={`${
                        mode.hideMobile ? 'hidden lg:inline-flex' : 'inline-flex'
                      } min-h-[34px] items-center rounded-md px-3 py-1 text-xs font-medium transition-all active:scale-95 whitespace-nowrap shrink-0 lg:min-h-[28px] lg:px-2.5 ${
                        editorMode === mode.id
                          ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-all active:scale-95 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white whitespace-nowrap shrink-0 lg:min-h-[32px]"
                  title="Attach image"
                >
                  <ImagePlus className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
                  <span className="hidden sm:inline">Image</span>
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handleAttachImages(e.target.files);
                    e.target.value = '';
                  }}
                />

                {/* Export Trigger */}
                <div className="relative">
                  <button
                    type="button"
                    disabled={exportingPdf}
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setExportMenuOpen((v) => !v);
                    }}
                    className="inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-all active:scale-95 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white whitespace-nowrap shrink-0 lg:min-h-[32px]"
                  >
                    {exportingPdf ? (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600 lg:h-3.5 lg:w-3.5" />
                    ) : (
                      <Download className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
                    )}
                    <span className="hidden sm:inline">
                      {exportingPdf ? 'Exporting...' : 'Export'}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </button>

                  <AnimatePresence>
                    {exportMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.98 }}
                        transition={{ duration: 0.14 }}
                        onMouseLeave={() => setExportMenuOpen(false)}
                        className="hidden sm:block absolute right-0 z-30 mt-1.5 w-60 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-md dark:border-slate-800 dark:bg-[#111827]/95"
                      >
                        <button
                          type="button"
                          onClick={() => handleExportPdf(activeNote)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-900 hover:bg-blue-50 hover:text-blue-700 dark:text-slate-100 dark:hover:bg-blue-950/50 dark:hover:text-blue-300"
                        >
                          <FileDown className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                          Export as PDF (.pdf)
                        </button>
                        <div className="my-1 border-t border-slate-200/80 dark:border-slate-800" />
                        <button
                          type="button"
                          onClick={async () => {
                            setExportMenuOpen(false);
                            await exportNoteAsMarkdownZip(activeNote);
                            showToast('Exported Markdown + images (.zip)');
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Markdown + Images (.zip)
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setExportMenuOpen(false);
                            await exportNoteAsPortableHtml(activeNote, lastRenderedHtml);
                            showToast('Exported portable HTML');
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Portable HTML (.html)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setExportMenuOpen(false);
                            navigator.clipboard.writeText(buildPortableMarkdown(activeNote));
                            showToast('Copied Markdown');
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy Markdown
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setExportMenuOpen(false);
                            window.print();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Print Note
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Overflow Actions Menu (Pin, Delete) */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setExportMenuOpen(false);
                      setConfirmDeleteId(null);
                      setMoreMenuOpen((v) => !v);
                    }}
                    className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-600 transition-all active:scale-95 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white lg:min-h-[32px] lg:min-w-[32px]"
                    aria-label="More note actions"
                    title="More actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>

                  <AnimatePresence>
                    {moreMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.98 }}
                        transition={{ duration: 0.14 }}
                        onMouseLeave={() => setMoreMenuOpen(false)}
                        className="absolute right-0 z-30 mt-1.5 w-48 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-md dark:border-slate-800 dark:bg-[#111827]/95"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onUpdateNote({
                              ...activeNote,
                              pinned: !activeNote.pinned,
                              updatedAt: Date.now(),
                            });
                            setMoreMenuOpen(false);
                            showToast(activeNote.pinned ? 'Unpinned note' : 'Pinned to top');
                          }}
                          className="flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 lg:min-h-0"
                        >
                          <Pin className="h-3.5 w-3.5" />
                          {activeNote.pinned ? 'Unpin note' : 'Pin to top'}
                        </button>

                        {confirmDeleteId === activeNote.id ? (
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteNote(activeNote.id);
                              setConfirmDeleteId(null);
                              setMoreMenuOpen(false);
                              onMobileScreenChange('list');
                            }}
                            className="flex min-h-[40px] w-full items-center gap-2.5 rounded-lg bg-red-600 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-red-700 lg:min-h-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Tap again to delete
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(activeNote.id)}
                            className="flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 lg:min-h-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete note
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Scrollable Note Body */}
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              {/* Editorial Note Header */}
              <div className="mx-auto w-full max-w-3xl px-5 pt-7 pb-4 sm:px-8">
                <input
                  type="text"
                  value={activeNote.title}
                  onChange={(e) =>
                    onUpdateNote({ ...activeNote, title: e.target.value, updatedAt: Date.now() })
                  }
                  placeholder="Untitled study note"
                  className="w-full bg-transparent font-display text-2xl font-bold tracking-tight text-slate-900 outline-none placeholder:text-slate-300 dark:text-slate-50 dark:placeholder:text-slate-700 sm:text-[1.875rem]"
                />

                <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400 tabular-nums dark:text-slate-500">
                  <select
                    aria-label="Source AI platform"
                    value={activeNote.sourcePlatform}
                    onChange={(e) =>
                      onUpdateNote({
                        ...activeNote,
                        sourcePlatform: e.target.value as AiPlatform,
                        updatedAt: Date.now(),
                      })
                    }
                    className="cursor-pointer appearance-none bg-transparent font-medium text-slate-600 outline-none hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  >
                    {PLATFORMS.map((p) => (
                      <option key={p} value={p} className="bg-white dark:bg-slate-900">
                        {p}
                      </option>
                    ))}
                  </select>

                  <span aria-hidden="true">·</span>

                  <select
                    aria-label="Notebook folder"
                    value={activeNote.notebookId}
                    onChange={(e) =>
                      onUpdateNote({
                        ...activeNote,
                        notebookId: e.target.value,
                        updatedAt: Date.now(),
                      })
                    }
                    className="cursor-pointer appearance-none bg-transparent font-medium text-slate-600 outline-none hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  >
                    {notebooks.map((nb) => (
                      <option key={nb.id} value={nb.id} className="bg-white dark:bg-slate-900">
                        {nb.name}
                      </option>
                    ))}
                  </select>

                  <span aria-hidden="true">·</span>
                  <span>{formatShortDate(activeNote.updatedAt)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{estimateReadMinutes(activeNote.markdown)} min read</span>
                  {assetEntries.length > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {assetEntries.length} image{assetEntries.length > 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Note Content */}
              <div
                className={`mx-auto flex w-full flex-1 flex-col px-5 pb-12 sm:px-8 ${
                  editorMode === 'split' ? 'max-w-6xl' : 'max-w-3xl'
                }`}
              >
                {editorMode === 'read' && (
                  <div className="pt-2">
                    {activeNote.markdown.trim().length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 px-5 py-12 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <p>
                          Press <kbd className="font-mono font-semibold text-slate-700 dark:text-slate-200">Ctrl+V</kbd> / <kbd className="font-mono font-semibold text-slate-700 dark:text-slate-200">Cmd+V</kbd> anywhere here to paste AI text or screenshots.
                        </p>
                        <button
                          type="button"
                          onClick={() => setEditorMode('source')}
                          className="mt-3 inline-flex min-h-[38px] items-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          Start typing note
                        </button>
                      </div>
                    ) : (
                      <RichNoteRenderer
                        markdown={activeNote.markdown}
                        assets={activeNote.assets}
                        onToggleCheckbox={handleToggleCheckbox}
                        onRenderedHtmlChange={setLastRenderedHtml}
                        onRequestCropAsset={(assetId) => setCropAssetId(assetId)}
                      />
                    )}
                  </div>
                )}

                {editorMode === 'source' && (
                  <div className="flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 lg:rounded-xl">
                    {/* Compact Quick-Format Strip for Mobile & Desktop Editing */}
                    <div className="no-scrollbar sticky top-0 z-10 flex items-center gap-1 overflow-x-auto rounded-t-2xl border-b border-slate-200 bg-slate-50/95 px-2.5 py-1.5 backdrop-blur-sm dark:border-slate-800 dark:bg-[#111827]/95 lg:rounded-t-xl">
                      <button
                        type="button"
                        onClick={() => wrapSelection('## ', '', 'Heading')}
                        className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-md text-slate-600 transition-colors active:scale-95 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        title="Heading"
                      >
                        <Heading2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => wrapSelection('**', '**', 'bold')}
                        className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-md text-slate-600 transition-colors active:scale-95 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        title="Bold"
                      >
                        <Bold className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => wrapSelection('```\n', '\n```', 'code')}
                        className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-md text-slate-600 transition-colors active:scale-95 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        title="Code block"
                      >
                        <Code2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => wrapSelection('$$\n', '\n$$', 'E = mc^2')}
                        className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-md text-slate-600 transition-colors active:scale-95 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        title="Math formula"
                      >
                        <Sigma className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          insertTextAtCursor(
                            activeNote,
                            '\n| Column A | Column B |\n| :--- | :--- |\n| Value 1 | Value 2 |\n'
                          )
                        }
                        className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-md text-slate-600 transition-colors active:scale-95 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        title="Insert table"
                      >
                        <Table2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => wrapSelection('- [ ] ', '', 'Study task')}
                        className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-md text-slate-600 transition-colors active:scale-95 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        title="Checklist item"
                      >
                        <CheckSquare className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <textarea
                      ref={textareaRef}
                      value={activeNote.markdown}
                      onPaste={handleTextareaPaste}
                      onChange={(e) =>
                        onUpdateNote({
                          ...activeNote,
                          markdown: e.target.value,
                          updatedAt: Date.now(),
                        })
                      }
                      className="no-scrollbar min-h-[360px] w-full resize-none overflow-hidden bg-transparent p-4 font-mono text-[13px] leading-relaxed text-slate-800 outline-none dark:text-slate-200 sm:p-5"
                      placeholder="Write notes or press Ctrl+V / Cmd+V to paste directly from ChatGPT, Claude, Gemini..."
                    />
                  </div>
                )}

                {editorMode === 'split' && (
                  <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
                    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                      <textarea
                        ref={textareaRef}
                        value={activeNote.markdown}
                        onPaste={handleTextareaPaste}
                        onChange={(e) =>
                          onUpdateNote({
                            ...activeNote,
                            markdown: e.target.value,
                            updatedAt: Date.now(),
                          })
                        }
                        placeholder="Type or Ctrl+V paste here..."
                        className="no-scrollbar min-h-[540px] w-full flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-slate-800 outline-none dark:text-slate-200"
                      />
                    </div>

                    <div className="rounded-xl border border-slate-200 p-5 dark:border-slate-800">
                      <RichNoteRenderer
                        markdown={activeNote.markdown}
                        assets={activeNote.assets}
                        onToggleCheckbox={handleToggleCheckbox}
                        onRenderedHtmlChange={setLastRenderedHtml}
                        onRequestCropAsset={(assetId) => setCropAssetId(assetId)}
                      />
                    </div>
                  </div>
                )}

                {editorMode !== 'read' && assetEntries.length > 0 && (
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-[#111827] lg:rounded-xl">
                    <div className="mb-3 text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Embedded Images ({assetEntries.length})
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {assetEntries.map((asset) => {
                        const isCroppable =
                          asset.dataUrl.startsWith('data:image/') &&
                          !asset.dataUrl.startsWith('data:image/svg');
                        return (
                          <div
                            key={asset.id}
                            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-[#0B0F17]"
                          >
                            <img
                              src={asset.dataUrl}
                              alt={asset.caption || asset.name}
                              referrerPolicy="no-referrer"
                              className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                                {asset.name}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                                <button
                                  type="button"
                                  onClick={() =>
                                    insertTextAtCursor(
                                      activeNote,
                                      `\n![${asset.caption || asset.name}](folio-asset://${asset.id})\n`
                                    )
                                  }
                                  className="text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  Insert
                                </button>
                                {isCroppable && (
                                  <>
                                    <span className="text-slate-300 dark:text-slate-700">·</span>
                                    <button
                                      type="button"
                                      onClick={() => setCropAssetId(asset.id)}
                                      className="inline-flex items-center gap-0.5 text-slate-700 hover:text-slate-900 hover:underline dark:text-slate-300 dark:hover:text-white"
                                    >
                                      <Crop className="h-3 w-3" />
                                      Crop
                                    </button>
                                  </>
                                )}
                                <span className="text-slate-300 dark:text-slate-700">·</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextAssets = { ...activeNote.assets };
                                    delete nextAssets[asset.id];
                                    onUpdateNote({
                                      ...activeNote,
                                      assets: nextAssets,
                                      updatedAt: Date.now(),
                                    });
                                  }}
                                  className="text-red-600 hover:underline dark:text-red-400"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </main>

      {/* Mobile Frosted Bottom Action Sheet for Export */}
      <AnimatePresence>
        {exportMenuOpen && activeNote && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setExportMenuOpen(false)}
            className="fixed inset-0 z-50 flex items-end bg-slate-950/50 backdrop-blur-xs sm:hidden"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded-t-3xl border-t border-slate-200 bg-white/95 p-5 pb-8 backdrop-blur-md dark:border-slate-800 dark:bg-[#111827]/95"
            >
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
              <div className="mb-3 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                Export Note
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => handleExportPdf(activeNote)}
                  className="flex min-h-[48px] w-full items-center gap-3 rounded-xl bg-blue-50/70 px-3.5 text-left text-sm font-semibold text-blue-700 active:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:active:bg-blue-950"
                >
                  <FileDown className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Export as PDF (.pdf)
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setExportMenuOpen(false);
                    await exportNoteAsMarkdownZip(activeNote);
                    showToast('Exported Markdown + images (.zip)');
                  }}
                  className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3.5 text-left text-sm font-medium text-slate-800 active:bg-slate-100 dark:text-slate-100 dark:active:bg-slate-800"
                >
                  <Download className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Markdown + Images (.zip)
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setExportMenuOpen(false);
                    await exportNoteAsPortableHtml(activeNote, lastRenderedHtml);
                    showToast('Exported portable HTML');
                  }}
                  className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3.5 text-left text-sm font-medium text-slate-800 active:bg-slate-100 dark:text-slate-100 dark:active:bg-slate-800"
                >
                  <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Portable HTML (.html)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExportMenuOpen(false);
                    navigator.clipboard.writeText(buildPortableMarkdown(activeNote));
                    showToast('Copied Markdown');
                  }}
                  className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3.5 text-left text-sm font-medium text-slate-800 active:bg-slate-100 dark:text-slate-100 dark:active:bg-slate-800"
                >
                  <Copy className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Copy Markdown
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExportMenuOpen(false);
                    window.print();
                  }}
                  className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3.5 text-left text-sm font-medium text-slate-800 active:bg-slate-100 dark:text-slate-100 dark:active:bg-slate-800"
                >
                  <Printer className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Print Note
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick Screenshot / Image Cropper Modal */}
      <AnimatePresence>
        {cropAssetId && activeNote && activeNote.assets[cropAssetId] && (
          <ImageCropModal
            asset={activeNote.assets[cropAssetId]}
            onCancel={() => setCropAssetId(null)}
            onApply={(croppedDataUrl, mimeType) => {
              const target = activeNote.assets[cropAssetId];
              if (!target) {
                setCropAssetId(null);
                return;
              }
              onUpdateNote({
                ...activeNote,
                assets: {
                  ...activeNote.assets,
                  [cropAssetId]: {
                    ...target,
                    dataUrl: croppedDataUrl,
                    mimeType,
                  },
                },
                updatedAt: Date.now(),
              });
              setCropAssetId(null);
              showToast('Image cropped');
            }}
          />
        )}
      </AnimatePresence>

      {/* Floating Frosted Toast with optional quick Crop action */}
      <AnimatePresence>
        {toastState && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-xl border border-slate-200 bg-white/95 px-4 py-2 text-xs font-medium text-slate-900 shadow-lg backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100 lg:bottom-6"
          >
            <span>{toastState.msg}</span>
            {toastState.cropAssetId && (
              <button
                type="button"
                onClick={() => {
                  const id = toastState.cropAssetId!;
                  setToastState(null);
                  setCropAssetId(id);
                }}
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700"
              >
                <Crop className="h-3 w-3" />
                Crop
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
