import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { AiPlatform, Note, Notebook, NoteAsset } from '../types/note';

const ALLOWED_PLATFORMS = new Set<AiPlatform>([
  'ChatGPT',
  'Claude',
  'Gemini',
  'Perplexity',
  'DeepSeek',
  'Web',
  'Manual',
]);

function sanitizeId(raw: string, fallbackPrefix: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned.length > 0 ? cleaned : `${fallbackPrefix}_${Date.now().toString(36)}`;
}

export async function compressImageDataUrlIfNeeded(
  dataUrl: string,
  mimeType: string,
  maxBytes = 780000
): Promise<{ dataUrl: string; mimeType: string }> {
  if (!dataUrl.startsWith('data:image/') || dataUrl.startsWith('data:image/svg')) {
    return { dataUrl, mimeType };
  }
  if (dataUrl.length <= maxBytes) {
    return { dataUrl, mimeType };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 1600;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ dataUrl: dataUrl.slice(0, maxBytes), mimeType });
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.86;
        let out = canvas.toDataURL('image/jpeg', quality);
        while (out.length > maxBytes && quality > 0.35) {
          quality -= 0.12;
          out = canvas.toDataURL('image/jpeg', quality);
        }

        if (out.length > maxBytes) {
          const shrinkCanvas = document.createElement('canvas');
          shrinkCanvas.width = Math.max(320, Math.round(width * 0.65));
          shrinkCanvas.height = Math.max(240, Math.round(height * 0.65));
          const shrinkCtx = shrinkCanvas.getContext('2d');
          if (shrinkCtx) {
            shrinkCtx.fillStyle = '#ffffff';
            shrinkCtx.fillRect(0, 0, shrinkCanvas.width, shrinkCanvas.height);
            shrinkCtx.drawImage(canvas, 0, 0, shrinkCanvas.width, shrinkCanvas.height);
            out = shrinkCanvas.toDataURL('image/jpeg', 0.72);
          }
        }

        resolve({ dataUrl: out, mimeType: 'image/jpeg' });
      } catch {
        resolve({ dataUrl, mimeType });
      }
    };
    img.onerror = () => resolve({ dataUrl, mimeType });
    img.src = dataUrl;
  });
}

export async function pushNotebookToCloud(uid: string, notebook: Notebook): Promise<void> {
  const id = sanitizeId(notebook.id, 'nb');
  const path = `users/${uid}/notebooks/${id}`;
  try {
    await setDoc(
      doc(db, 'users', uid, 'notebooks', id),
      {
        id,
        ownerId: uid,
        name: (notebook.name || 'Untitled Notebook').trim().slice(0, 100) || 'Untitled Notebook',
        createdAt: Number(notebook.createdAt) || Date.now(),
        serverUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function pushAssetToCloud(
  uid: string,
  noteId: string,
  asset: NoteAsset
): Promise<void> {
  const assetId = sanitizeId(asset.id, 'asset');
  const safeNoteId = sanitizeId(noteId, 'note');
  const path = `users/${uid}/assets/${assetId}`;

  const compressed = await compressImageDataUrlIfNeeded(asset.dataUrl, asset.mimeType);
  if (compressed.dataUrl.length > 890000) {
    // Still above 900KB limit; skip uploading binary asset rather than violating rules
    return;
  }

  const payload: Record<string, unknown> = {
    id: assetId,
    ownerId: uid,
    noteId: safeNoteId,
    name: (asset.name || 'image.png').slice(0, 200) || 'image.png',
    mimeType: (compressed.mimeType || 'image/png').slice(0, 100),
    dataUrl: compressed.dataUrl,
    createdAt: Number(asset.createdAt) || Date.now(),
    serverUpdatedAt: serverTimestamp(),
  };

  if (asset.caption && asset.caption.trim().length > 0) {
    payload.caption = asset.caption.trim().slice(0, 300);
  }

  try {
    await setDoc(doc(db, 'users', uid, 'assets', assetId), payload, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function pushNoteToCloud(uid: string, note: Note): Promise<void> {
  const noteId = sanitizeId(note.id, 'note');
  const notebookId = sanitizeId(note.notebookId || 'nb_clips', 'nb');
  const notePath = `users/${uid}/notes/${noteId}`;

  const assetEntries = Object.values(note.assets || {}).slice(0, 25);
  await Promise.all(assetEntries.map((asset) => pushAssetToCloud(uid, noteId, asset)));

  const assetIds = assetEntries.map((a) => sanitizeId(a.id, 'asset'));
  const platform: AiPlatform = ALLOWED_PLATFORMS.has(note.sourcePlatform)
    ? note.sourcePlatform
    : 'Manual';

  const payload: Record<string, unknown> = {
    id: noteId,
    ownerId: uid,
    title: (note.title || '').slice(0, 200),
    notebookId,
    sourcePlatform: platform,
    markdown: (note.markdown || '').slice(0, 500000),
    pinned: Boolean(note.pinned),
    assetIds,
    createdAt: Number(note.createdAt) || Date.now(),
    updatedAt: Number(note.updatedAt) || Date.now(),
    serverUpdatedAt: serverTimestamp(),
  };

  if (note.sourceUrl && note.sourceUrl.trim().length > 0) {
    payload.sourceUrl = note.sourceUrl.trim().slice(0, 1000);
  }

  try {
    await setDoc(doc(db, 'users', uid, 'notes', noteId), payload, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, notePath);
  }
}

export async function deleteNoteFromCloud(uid: string, note: Note): Promise<void> {
  const noteId = sanitizeId(note.id, 'note');
  const path = `users/${uid}/notes/${noteId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'notes', noteId));
    await Promise.all(
      Object.keys(note.assets || {}).map((assetId) =>
        deleteDoc(doc(db, 'users', uid, 'assets', sanitizeId(assetId, 'asset'))).catch(() => {})
      )
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

interface CloudNoteDoc {
  id: string;
  ownerId: string;
  title: string;
  notebookId: string;
  sourcePlatform: AiPlatform;
  sourceUrl?: string;
  markdown: string;
  pinned: boolean;
  assetIds?: string[];
  createdAt: number;
  updatedAt: number;
}

interface CloudAssetDoc {
  id: string;
  ownerId: string;
  noteId: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  caption?: string;
  createdAt: number;
}

export interface CloudWorkspaceSnapshot {
  notes: Note[];
  notebooks: Notebook[];
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export function subscribeUserCloudWorkspace(
  uid: string,
  onUpdate: (snapshot: CloudWorkspaceSnapshot) => void,
  onError?: (err: Error) => void
): () => void {
  let cloudNotebooks: Notebook[] = [];
  let cloudNoteDocs: CloudNoteDoc[] = [];
  const assetById = new Map<string, CloudAssetDoc>();
  let notebooksLoaded = false;
  let notesLoaded = false;
  let assetsLoaded = false;
  let lastFromCache = false;
  let lastPending = false;

  const emit = () => {
    if (!notebooksLoaded || !notesLoaded || !assetsLoaded) return;

    const hydratedNotes: Note[] = cloudNoteDocs.map((docItem) => {
      const assetsMap: Record<string, NoteAsset> = {};
      for (const aid of docItem.assetIds || []) {
        const found = assetById.get(aid);
        if (found) {
          assetsMap[found.id] = {
            id: found.id,
            name: found.name,
            mimeType: found.mimeType,
            dataUrl: found.dataUrl,
            caption: found.caption,
            createdAt: found.createdAt,
          };
        }
      }
      // Also attach any assets linked via noteId if not listed in assetIds
      for (const found of assetById.values()) {
        if (found.noteId === docItem.id && !assetsMap[found.id]) {
          assetsMap[found.id] = {
            id: found.id,
            name: found.name,
            mimeType: found.mimeType,
            dataUrl: found.dataUrl,
            caption: found.caption,
            createdAt: found.createdAt,
          };
        }
      }

      return {
        id: docItem.id,
        title: docItem.title,
        notebookId: docItem.notebookId,
        sourcePlatform: docItem.sourcePlatform,
        sourceUrl: docItem.sourceUrl,
        markdown: docItem.markdown,
        pinned: docItem.pinned,
        assets: assetsMap,
        createdAt: docItem.createdAt,
        updatedAt: docItem.updatedAt,
      };
    });

    onUpdate({
      notes: hydratedNotes.sort((a, b) => b.updatedAt - a.updatedAt),
      notebooks: cloudNotebooks.sort((a, b) => a.createdAt - b.createdAt),
      fromCache: lastFromCache,
      hasPendingWrites: lastPending,
    });
  };

  const unsubNotebooks = onSnapshot(
    query(collection(db, 'users', uid, 'notebooks'), where('ownerId', '==', uid)),
    { includeMetadataChanges: true },
    (snap) => {
      notebooksLoaded = true;
      lastFromCache = snap.metadata.fromCache;
      lastPending = snap.metadata.hasPendingWrites;
      cloudNotebooks = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          name: String(data.name || 'Notebook'),
          createdAt: Number(data.createdAt) || Date.now(),
        };
      });
      emit();
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/notebooks`);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );

  const unsubNotes = onSnapshot(
    query(collection(db, 'users', uid, 'notes'), where('ownerId', '==', uid)),
    { includeMetadataChanges: true },
    (snap) => {
      notesLoaded = true;
      lastFromCache = snap.metadata.fromCache;
      lastPending = snap.metadata.hasPendingWrites;
      cloudNoteDocs = snap.docs.map((d) => d.data() as CloudNoteDoc);
      emit();
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/notes`);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );

  const unsubAssets = onSnapshot(
    query(collection(db, 'users', uid, 'assets'), where('ownerId', '==', uid)),
    { includeMetadataChanges: true },
    (snap) => {
      assetsLoaded = true;
      assetById.clear();
      for (const d of snap.docs) {
        const data = d.data() as CloudAssetDoc;
        assetById.set(data.id || d.id, data);
      }
      emit();
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/assets`);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );

  return () => {
    unsubNotebooks();
    unsubNotes();
    unsubAssets();
  };
}
