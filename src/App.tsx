import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { onAuthStateChanged } from 'firebase/auth';
import { BookOpen, Cloud, CloudOff, Moon, Plus, Puzzle, Search, Sun } from 'lucide-react';
import type { AppTab, Note, Notebook } from './types/note';
import {
  DEFAULT_NOTEBOOKS,
  DEFAULT_NOTES,
  loadWorkspaceData,
  saveNotebooks,
  saveNotes,
} from './lib/noteStorage';
import { convertAiHtmlToNote } from './lib/aiClipperEngine';
import { WorkspaceView, type CloudSyncUserInfo } from './components/WorkspaceView';
import { ExtensionBuilderView } from './components/ExtensionBuilderView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { auth, signInWithGoogle, signOutUser } from './firebase';
import {
  deleteNoteFromCloud,
  pushNotebookToCloud,
  pushNoteToCloud,
  subscribeUserCloudWorkspace,
} from './lib/cloudSync';

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const DEFAULT_NOTE_IDS = new Set(DEFAULT_NOTES.map((n) => n.id));
const DEFAULT_NOTE_TIMESTAMPS = new Map(DEFAULT_NOTES.map((n) => [n.id, n.updatedAt]));

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('notes');
  const [mobileScreen, setMobileScreen] = useState<'list' | 'note'>('list');
  const [notes, setNotes] = useState<Note[]>(DEFAULT_NOTES);
  const [notebooks, setNotebooks] = useState<Notebook[]>(DEFAULT_NOTEBOOKS);
  const [activeNoteId, setActiveNoteId] = useState<string>(DEFAULT_NOTES[0].id);
  const [autoEditSignal, setAutoEditSignal] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('folio_theme') === 'dark';
  });

  const isOnline = useOnlineStatus();
  const [user, setUser] = useState<CloudSyncUserInfo | null>(null);
  const [syncState, setSyncState] = useState<'local' | 'syncing' | 'synced' | 'offline'>('local');

  const notesRef = useRef<Note[]>(notes);
  const notebooksRef = useRef<Notebook[]>(notebooks);
  const pendingCloudTimersRef = useRef<Map<string, number>>(new Map());
  const cloudKnownNoteIdsRef = useRef<Set<string>>(new Set());
  const hasSeededCloudRef = useRef(false);

  notesRef.current = notes;
  notebooksRef.current = notebooks;

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('folio_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('folio_theme', 'light');
    }
  }, [darkMode]);

  // Global Cmd+K / Ctrl+K quick switcher
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickOpen((v) => !v);
        setQuickQuery('');
      } else if (e.key === 'Escape') {
        setQuickOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Load IndexedDB + handle #clip= extension payload or PWA share_target query params
  useEffect(() => {
    let mounted = true;
    loadWorkspaceData().then(({ notes: loadedNotes, notebooks: loadedBooks }) => {
      if (!mounted) return;
      let nextNotes = loadedNotes;
      let targetNoteId = loadedNotes[0]?.id || '';

      if (typeof window !== 'undefined' && window.location.hash.startsWith('#clip=')) {
        try {
          const rawParam = decodeURIComponent(window.location.hash.slice(6));
          const jsonStr = decodeURIComponent(escape(atob(rawParam)));
          const payload = JSON.parse(jsonStr);
          const converted = convertAiHtmlToNote(payload.html || '', payload.plainText || '');
          const clippedNote: Note = {
            id: createId('note'),
            title: payload.title || converted.suggestedTitle,
            notebookId: loadedBooks[loadedBooks.length - 1]?.id || 'nb_clips',
            sourcePlatform: payload.platform || converted.stats.platformDetected,
            sourceUrl: payload.sourceUrl,
            markdown: converted.markdown,
            assets: converted.assets,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          nextNotes = [clippedNote, ...loadedNotes];
          targetNoteId = clippedNote.id;
          saveNotes(nextNotes);
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
          setMobileScreen('note');
        } catch {
          // ignore malformed extension hash
        }
      } else if (typeof window !== 'undefined' && window.location.search) {
        const params = new URLSearchParams(window.location.search);
        const sharedTitle = params.get('share_title')?.trim() || '';
        const sharedText = params.get('share_text')?.trim() || '';
        const sharedUrl = params.get('share_url')?.trim() || '';
        if (sharedTitle || sharedText || sharedUrl) {
          const parts: string[] = [];
          if (sharedText) parts.push(sharedText);
          if (sharedUrl && !sharedText.includes(sharedUrl)) {
            parts.push(`[Source link](${sharedUrl})`);
          }
          const now = Date.now();
          const sharedNote: Note = {
            id: createId('note'),
            title: sharedTitle || 'Shared Note',
            notebookId: loadedBooks[loadedBooks.length - 1]?.id || 'nb_clips',
            sourcePlatform: 'Web',
            sourceUrl: sharedUrl || undefined,
            markdown: parts.join('\n\n'),
            assets: {},
            createdAt: now,
            updatedAt: now,
          };
          nextNotes = [sharedNote, ...loadedNotes];
          targetNoteId = sharedNote.id;
          saveNotes(nextNotes);
          window.history.replaceState(null, '', window.location.pathname);
          setMobileScreen('note');
        }
      }

      setNotes(nextNotes);
      setNotebooks(loadedBooks);
      setActiveNoteId(targetNoteId);
      setHydrated(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveNotes(notes);
  }, [notes, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveNotebooks(notebooks);
  }, [notebooks, hydrated]);

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser && fbUser.emailVerified === true) {
        setUser({
          uid: fbUser.uid,
          displayName: fbUser.displayName,
          email: fbUser.email,
          photoURL: fbUser.photoURL,
        });
        setSyncState(navigator.onLine ? 'syncing' : 'offline');
      } else {
        setUser(null);
        setSyncState('local');
        cloudKnownNoteIdsRef.current.clear();
        hasSeededCloudRef.current = false;
      }
    });
    return () => unsub();
  }, []);

  // Offline-first Cloud Sync subscription when signed in
  useEffect(() => {
    if (!hydrated || !user) return;
    const uid = user.uid;

    const unsub = subscribeUserCloudWorkspace(
      uid,
      (snapshot) => {
        setSyncState(
          !navigator.onLine
            ? 'offline'
            : snapshot.hasPendingWrites
              ? 'syncing'
              : 'synced'
        );

        const localNotes = notesRef.current;
        const localBooks = notebooksRef.current;

        // First-time sign-in with an empty cloud workspace: seed from local IndexedDB
        if (
          snapshot.notes.length === 0 &&
          snapshot.notebooks.length === 0 &&
          !hasSeededCloudRef.current
        ) {
          hasSeededCloudRef.current = true;
          void Promise.all([
            ...localBooks.map((nb) => pushNotebookToCloud(uid, nb).catch(() => {})),
            ...localNotes.map((n) => pushNoteToCloud(uid, n).catch(() => {})),
          ]);
          return;
        }

        // Merge notebooks
        const mergedBooksMap = new Map<string, Notebook>();
        for (const nb of snapshot.notebooks) {
          mergedBooksMap.set(nb.id, nb);
        }
        for (const nb of localBooks) {
          if (!mergedBooksMap.has(nb.id)) {
            mergedBooksMap.set(nb.id, nb);
            void pushNotebookToCloud(uid, nb).catch(() => {});
          }
        }
        const nextBooks = Array.from(mergedBooksMap.values()).sort(
          (a, b) => a.createdAt - b.createdAt
        );
        if (nextBooks.length > 0) {
          setNotebooks(nextBooks);
        }

        // Merge notes by updatedAt (preserve remote deletions for known notes)
        const cloudMap = new Map(snapshot.notes.map((n) => [n.id, n]));
        const nextMap = new Map<string, Note>();
        const notesToPushUp: Note[] = [];

        for (const cloudNote of snapshot.notes) {
          nextMap.set(cloudNote.id, cloudNote);
        }

        for (const localNote of localNotes) {
          const cloudNote = cloudMap.get(localNote.id);
          if (cloudNote) {
            if (localNote.updatedAt > cloudNote.updatedAt) {
              nextMap.set(localNote.id, localNote);
              notesToPushUp.push(localNote);
            }
          } else {
            const wasPreviouslyKnownInCloud = cloudKnownNoteIdsRef.current.has(localNote.id);
            const isUntouchedDefault =
              DEFAULT_NOTE_IDS.has(localNote.id) &&
              localNote.updatedAt === DEFAULT_NOTE_TIMESTAMPS.get(localNote.id) &&
              snapshot.notes.length > 0;

            if (!wasPreviouslyKnownInCloud && !isUntouchedDefault) {
              nextMap.set(localNote.id, localNote);
              notesToPushUp.push(localNote);
            }
          }
        }

        cloudKnownNoteIdsRef.current = new Set(snapshot.notes.map((n) => n.id));
        const mergedNotes = Array.from(nextMap.values()).sort(
          (a, b) => b.updatedAt - a.updatedAt
        );

        setNotes(mergedNotes);
        setActiveNoteId((prevId) =>
          mergedNotes.some((n) => n.id === prevId) ? prevId : mergedNotes[0]?.id || ''
        );

        if (notesToPushUp.length > 0) {
          void Promise.all(notesToPushUp.map((n) => pushNoteToCloud(uid, n).catch(() => {})));
        }
      },
      () => {
        setSyncState(navigator.onLine ? 'local' : 'offline');
      }
    );

    return () => {
      unsub();
    };
  }, [hydrated, user]);

  useEffect(() => {
    if (!user) return;
    if (!isOnline) {
      setSyncState('offline');
    } else if (syncState === 'offline') {
      setSyncState('synced');
    }
  }, [isOnline, user, syncState]);

  const scheduleNoteCloudPush = (note: Note) => {
    if (!user) return;
    const uid = user.uid;
    const existing = pendingCloudTimersRef.current.get(note.id);
    if (existing) {
      window.clearTimeout(existing);
    }
    setSyncState(isOnline ? 'syncing' : 'offline');
    const timer = window.setTimeout(() => {
      pendingCloudTimersRef.current.delete(note.id);
      void pushNoteToCloud(uid, note)
        .then(() => {
          cloudKnownNoteIdsRef.current.add(note.id);
          setSyncState(navigator.onLine ? 'synced' : 'offline');
        })
        .catch(() => {
          setSyncState(navigator.onLine ? 'local' : 'offline');
        });
    }, 600);
    pendingCloudTimersRef.current.set(note.id, timer);
  };

  const handleCreateNote = (notebookId?: string) => {
    const now = Date.now();
    const newNote: Note = {
      id: createId('note'),
      title: 'Untitled Note',
      notebookId: notebookId || notebooks[0]?.id || 'nb_clips',
      sourcePlatform: 'Manual',
      markdown: '',
      assets: {},
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [newNote, ...prev]);
    setActiveNoteId(newNote.id);
    setActiveTab('notes');
    setMobileScreen('note');
    setAutoEditSignal((s) => s + 1);
    scheduleNoteCloudPush(newNote);
  };

  const handleUpdateNote = (updated: Note) => {
    setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    scheduleNoteCloudPush(updated);
  };

  const handleDeleteNote = (id: string) => {
    const target = notes.find((n) => n.id === id);
    setNotes((prev) => {
      const remaining = prev.filter((n) => n.id !== id);
      if (activeNoteId === id) {
        setActiveNoteId(remaining[0]?.id || '');
      }
      return remaining;
    });
    if (user && target) {
      cloudKnownNoteIdsRef.current.delete(id);
      void deleteNoteFromCloud(user.uid, target).catch(() => {});
    }
  };

  const handleCreateNotebook = (name: string) => {
    const nb: Notebook = {
      id: createId('nb'),
      name,
      createdAt: Date.now(),
    };
    setNotebooks((prev) => [...prev, nb]);
    if (user) {
      void pushNotebookToCloud(user.uid, nb).catch(() => {});
    }
  };

  const handleImportNotes = (imported: Note[]) => {
    setNotes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      for (const item of imported) {
        if (item && item.id && typeof item.markdown === 'string') {
          byId.set(item.id, item);
          scheduleNoteCloudPush(item);
        }
      }
      return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    });
  };

  const handleSignIn = async () => {
    await signInWithGoogle();
  };

  const handleSignOut = async () => {
    await signOutUser();
  };

  const quickMatches = useMemo(() => {
    const q = quickQuery.trim().toLowerCase();
    if (!q) return notes.slice(0, 6);
    return notes
      .filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.markdown.toLowerCase().includes(q) ||
          n.sourcePlatform.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [notes, quickQuery]);

  const navItems: Array<{ id: AppTab; label: string }> = [
    { id: 'notes', label: 'Notes' },
    { id: 'extension', label: 'Chrome Extension' },
  ];

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white text-slate-900 dark:bg-[#0B0F17] dark:text-slate-100">
      {/* Frosted Top App Bar */}
      <header className="no-print z-40 flex h-[49px] shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white/85 px-4 backdrop-blur-md dark:border-slate-800 dark:bg-[#0B0F17]/85 lg:h-[57px] lg:gap-8 lg:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('notes');
              setMobileScreen('list');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            Folio
          </button>

          {!isOnline && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap">
              <CloudOff className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Offline</span>
            </span>
          )}
        </div>

        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-6 text-sm font-medium lg:flex"
        >
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`relative py-4 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'font-semibold text-slate-900 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {item.label}
                {active && (
                  <motion.span
                    layoutId="desktop-nav-underline"
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 dark:bg-blue-500"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton />

          {!user ? (
            <button
              type="button"
              onClick={handleSignIn}
              className="hidden h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 transition-all active:scale-95 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white sm:inline-flex whitespace-nowrap shrink-0"
              title="Sign in with Google to sync notes across devices"
            >
              <Cloud className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              Sync
            </button>
          ) : (
            <span
              className="hidden items-center gap-1.5 px-2 text-xs text-slate-500 dark:text-slate-400 sm:inline-flex whitespace-nowrap"
              title={`Signed in as ${user.email || user.displayName || 'Google User'}`}
            >
              <Cloud className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              {syncState === 'syncing' ? 'Syncing' : 'Synced'}
            </span>
          )}

          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition-all active:scale-95 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white lg:h-9 lg:w-9 lg:rounded-lg"
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => handleCreateNote()}
            className="hidden items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-all active:scale-95 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700 lg:inline-flex whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            New Note
          </button>
        </div>
      </header>

      {/* Main Flex Viewport */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'notes' ? (
            <motion.div
              key="tab-notes"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <WorkspaceView
                notes={notes}
                notebooks={notebooks}
                activeNoteId={activeNoteId}
                autoEditSignal={autoEditSignal}
                mobileScreen={mobileScreen}
                isOnline={isOnline}
                user={user}
                syncState={syncState}
                onSignIn={handleSignIn}
                onSignOut={handleSignOut}
                onMobileScreenChange={setMobileScreen}
                onSelectNote={setActiveNoteId}
                onUpdateNote={handleUpdateNote}
                onDeleteNote={handleDeleteNote}
                onCreateNote={handleCreateNote}
                onCreateNotebook={handleCreateNotebook}
                onImportNotes={handleImportNotes}
              />
            </motion.div>
          ) : (
            <motion.div
              key="tab-extension"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <ExtensionBuilderView />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Thumb-Zone Mobile/Tablet Bottom Tab Bar */}
      <nav
        aria-label="Mobile bottom navigation"
        className="no-print z-40 grid h-14 shrink-0 grid-cols-3 items-center border-t border-slate-200 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-[#0B0F17]/90 lg:hidden"
      >
        <button
          type="button"
          onClick={() => {
            setActiveTab('notes');
            setMobileScreen('list');
          }}
          className={`flex h-full flex-col items-center justify-center transition-transform active:scale-95 ${
            activeTab === 'notes'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <BookOpen className="h-5 w-5" />
          <span className="mt-0.5 text-[10px] font-medium tracking-tight">Notes</span>
        </button>

        <button
          type="button"
          onClick={() => handleCreateNote()}
          aria-label="New Note"
          className="flex h-full flex-col items-center justify-center text-slate-900 transition-transform active:scale-95 dark:text-white"
        >
          <span className="inline-flex h-8 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
            <Plus className="h-5 w-5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('extension')}
          className={`flex h-full flex-col items-center justify-center transition-transform active:scale-95 ${
            activeTab === 'extension'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <Puzzle className="h-5 w-5" />
          <span className="mt-0.5 text-[10px] font-medium tracking-tight">Extension</span>
        </button>
      </nav>

      {/* Cmd+K / Ctrl+K Quick Switcher */}
      <AnimatePresence>
        {quickOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={() => setQuickOpen(false)}
            className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/50 px-4 pt-20 backdrop-blur-xs"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -6 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur-md dark:border-slate-800 dark:bg-[#111827]/95"
            >
              <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  value={quickQuery}
                  onChange={(e) => setQuickQuery(e.target.value)}
                  placeholder="Jump to note..."
                  className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
                />
                <kbd className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 dark:border-slate-700">
                  ESC
                </kbd>
              </div>
              <div className="no-scrollbar max-h-72 overflow-y-auto p-2">
                {quickMatches.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => {
                      setActiveNoteId(note.id);
                      setActiveTab('notes');
                      setMobileScreen('note');
                      setQuickOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                      {note.title || 'Untitled Note'}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {note.sourcePlatform}
                    </span>
                  </button>
                ))}
                {quickMatches.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-slate-500">
                    No matching notes.
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
