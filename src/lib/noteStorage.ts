import type { Note, Notebook } from '../types/note';

const DB_NAME = 'folio_notes_db_v1';
const DB_VERSION = 1;
const STORE_NOTES = 'notes';
const STORE_NOTEBOOKS = 'notebooks';
const LS_FALLBACK_KEY = 'folio_notes_fallback_v1';

export const DEFAULT_NOTEBOOKS: Notebook[] = [
  { id: 'nb_ml', name: 'Machine Learning', createdAt: 1731600000000 },
  { id: 'nb_sys', name: 'Database & Systems', createdAt: 1731610000000 },
  { id: 'nb_clips', name: 'Quick AI Clips', createdAt: 1731620000000 },
];

export const DEFAULT_NOTES: Note[] = [
  {
    id: 'note_transformer_attention',
    title: 'Multi-Head Self-Attention & Scaled Dot-Product Math',
    notebookId: 'nb_ml',
    sourcePlatform: 'ChatGPT',
    sourceUrl: 'https://chatgpt.com',
    pinned: true,
    createdAt: 1731680000000,
    updatedAt: 1731702000000,
    assets: {
      asset_attn_arch: {
        id: 'asset_attn_arch',
        name: 'transformer-multi-head-attention.jpg',
        mimeType: 'image/jpeg',
        dataUrl: '/src/assets/images/diagram_transformer_attention_1794819322515.jpg',
        caption: 'Figure 1: Multi-Head Attention projection flow (Q, K, V matrices concatenated via W_O).',
        createdAt: 1731680000000,
      },
    },
    markdown: `## Core Mechanism

Transformers replace sequential recurrence with parallelizable **Scaled Dot-Product Attention**. Given query matrix $Q \\in \\mathbb{R}^{n \\times d_k}$, key matrix $K \\in \\mathbb{R}^{m \\times d_k}$, and value matrix $V \\in \\mathbb{R}^{m \\times d_v}$:

$$
\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right) V
$$

Why divide by $\\sqrt{d_k}$? When $d_k$ grows large, dot products grow in magnitude ($\\text{Var}(q \\cdot k) = d_k$), pushing the softmax function into regions with vanishingly small gradients.

![Figure 1: Multi-Head Attention projection flow (Q, K, V matrices concatenated via W_O).](folio-asset://asset_attn_arch)

## Multi-Head Projections

Instead of computing a single attention function with $d_{\\text{model}}$-dimensional keys, values, and queries, we linearly project them $h$ times into lower-dimensional subspaces:

$$
\\text{MultiHead}(Q, K, V) = \\text{Concat}(\\text{head}_1, \\dots, \\text{head}_h) W^O
$$

where each head is computed independently:

$$
\\text{head}_i = \\text{Attention}(Q W_i^Q, K W_i^K, V W_i^V)
$$

## Complexity Comparison

| Layer Type | Complexity per Layer | Sequential Operations | Maximum Path Length |
| :--- | :--- | :--- | :--- |
| Self-Attention | $O(n^2 \\cdot d)$ | $O(1)$ | $O(1)$ |
| Recurrent (RNN) | $O(n \\cdot d^2)$ | $O(n)$ | $O(n)$ |
| Convolutional | $O(k \\cdot n \\cdot d^2)$ | $O(1)$ | $O(\\log_k(n))$ |

## PyTorch Reference Implementation

\`\`\`python
import math
import torch
import torch.nn as nn
import torch.nn.functional as F

class ScaledDotProductAttention(nn.Module):
    def forward(self, q: torch.Tensor, k: torch.Tensor, v: torch.Tensor, mask=None):
        d_k = q.size(-1)
        scores = torch.matmul(q, k.transpose(-2, -1)) / math.sqrt(d_k)
        if mask is not None:
            scores = scores.masked_fill(mask == 0, float("-inf"))
        weights = F.softmax(scores, dim=-1)
        return torch.matmul(weights, v), weights
\`\`\`

> Key takeaway when studying: Standard copy-paste from AI chats breaks the KaTeX equations above into duplicated text and drops the embedded diagram URL once the chat session expires. Folio recovers the raw TeX annotation and stores images inline.
`,
  },
  {
    id: 'note_btree_indexing',
    title: 'PostgreSQL B-Tree Index Internals & Page Splits',
    notebookId: 'nb_sys',
    sourcePlatform: 'Claude',
    sourceUrl: 'https://claude.ai',
    createdAt: 1731640000000,
    updatedAt: 1731668000000,
    assets: {
      asset_btree: {
        id: 'asset_btree',
        name: 'balanced-btree-order4.jpg',
        mimeType: 'image/jpeg',
        dataUrl: '/src/assets/images/diagram_btree_index_1794819323405.jpg',
        caption: 'Figure 1: Balanced B-Tree index showing root keys, internal pointers, and doubly-linked leaf pages.',
        createdAt: 1731640000000,
      },
    },
    markdown: `## Why B-Trees Dominate Disk & SSD Storage

Relational engines like PostgreSQL use **B+Tree** variants (commonly called B-Tree in SQL DDL) because page reads are block-oriented ($8\\text{ KB}$ default page size in Postgres). High fan-out keeps tree height $h \\le 4$ even for hundreds of millions of rows:

$$
\\text{Max Keys} \\approx B^h \\quad \\text{where } B \\in [200, 500]
$$

![Figure 1: Balanced B-Tree index showing root keys, internal pointers, and doubly-linked leaf pages.](folio-asset://asset_btree)

## Leaf Page Anatomy & Range Scans

1. **Root & Internal Pages** store separator keys and child page numbers (\`BlockNumber\`).
2. **Leaf Pages** store \`(key, ctid)\` pairs where \`ctid\` points directly to the heap tuple \`(page_id, item_offset)\`.
3. **Sibling Links** (\`btpo_prev\` / \`btpo_next\`) allow \`ORDER BY\` and \`BETWEEN\` range scans to walk horizontally without re-traversing from the root.

### Index Scan vs. Index-Only Scan

| Scan Strategy | Heap Fetch Required | Visibility Map Check | Typical I/O Pattern |
| :--- | :--- | :--- | :--- |
| Index Scan | Yes (random I/O per match) | Ignored | Moderate to High |
| Bitmap Index Scan | Batched sequential page reads | Ignored | Low random seeks |
| Index-Only Scan | Only if page not all-visible | Required (\`VM\` bit) | Minimal I/O |

\`\`\`sql
-- Covering index enables Index-Only Scan without touching heap pages
CREATE INDEX CONCURRENTLY idx_orders_user_status
ON orders (user_id, created_at DESC)
INCLUDE (total_cents, currency);

EXPLAIN (ANALYZE, BUFFERS)
SELECT total_cents, currency
FROM orders
WHERE user_id = 4812
ORDER BY created_at DESC
LIMIT 20;
\`\`\`
`,
  },
  {
    id: 'note_backprop_chain_rule',
    title: 'Backpropagation & Gradient Flow Through Residual Layers',
    notebookId: 'nb_ml',
    sourcePlatform: 'Gemini',
    sourceUrl: 'https://gemini.google.com',
    createdAt: 1731590000000,
    updatedAt: 1731615000000,
    assets: {
      asset_backprop: {
        id: 'asset_backprop',
        name: 'neural-network-backprop-flow.jpg',
        mimeType: 'image/jpeg',
        dataUrl: '/src/assets/images/diagram_neural_backprop_1794819323369.jpg',
        caption: 'Forward activation pass (cobalt) vs. backward error gradient propagation (amber).',
        createdAt: 1731590000000,
      },
    },
    markdown: `## Reverse-Mode Automatic Differentiation

Backpropagation applies the multivariate chain rule from the scalar loss $\\mathcal{L}$ backward through each layer $l$. Defining the local error signal $\\delta^{(l)} = \\frac{\\partial \\mathcal{L}}{\\partial z^{(l)}}$:

$$
\\delta^{(l)} = \\left((W^{(l+1)})^T \\delta^{(l+1)}\\right) \\odot \\sigma'\\left(z^{(l)}\\right)
$$

The parameter gradients then follow immediately without recomputing upstream activations:

$$
\\frac{\\partial \\mathcal{L}}{\\partial W^{(l)}} = \\delta^{(l)} \\left(a^{(l-1)}\\right)^T, \\qquad \\frac{\\partial \\mathcal{L}}{\\partial b^{(l)}} = \\delta^{(l)}
$$

![Forward activation pass (cobalt) vs. backward error gradient propagation (amber).](folio-asset://asset_backprop)

## Checklist for Avoiding Vanishing Gradients

- [x] Replace saturating sigmoid/tanh activations with \`GELU\` or \`SiLU\` in deep blocks
- [x] Apply Pre-LayerNorm before attention and MLP sub-blocks
- [ ] Verify gradient norm clipping threshold (\`max_norm = 1.0\`) during warmup
`,
  },
];

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NOTES)) {
        db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_NOTEBOOKS)) {
        db.createObjectStore(STORE_NOTEBOOKS, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function replaceStoreItems<T>(db: IDBDatabase, storeName: string, items: T[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadWorkspaceData(): Promise<{ notes: Note[]; notebooks: Notebook[] }> {
  try {
    const db = await openDatabase();
    const [notes, notebooks] = await Promise.all([
      readAllFromStore<Note>(db, STORE_NOTES),
      readAllFromStore<Notebook>(db, STORE_NOTEBOOKS),
    ]);

    if (notes.length === 0 && notebooks.length === 0) {
      await Promise.all([
        replaceStoreItems(db, STORE_NOTES, DEFAULT_NOTES),
        replaceStoreItems(db, STORE_NOTEBOOKS, DEFAULT_NOTEBOOKS),
      ]);
      db.close();
      return { notes: DEFAULT_NOTES, notebooks: DEFAULT_NOTEBOOKS };
    }

    db.close();
    return {
      notes: notes.sort((a, b) => b.updatedAt - a.updatedAt),
      notebooks: notebooks.length > 0 ? notebooks : DEFAULT_NOTEBOOKS,
    };
  } catch {
    try {
      const raw = localStorage.getItem(LS_FALLBACK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.notes) && Array.isArray(parsed.notebooks)) {
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
    return { notes: DEFAULT_NOTES, notebooks: DEFAULT_NOTEBOOKS };
  }
}

export async function saveNotes(notes: Note[]): Promise<void> {
  try {
    const db = await openDatabase();
    await replaceStoreItems(db, STORE_NOTES, notes);
    db.close();
  } catch {
    try {
      const raw = localStorage.getItem(LS_FALLBACK_KEY);
      const current = raw ? JSON.parse(raw) : { notebooks: DEFAULT_NOTEBOOKS };
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify({ ...current, notes }));
    } catch {
      // ignore quota errors
    }
  }
}

export async function saveNotebooks(notebooks: Notebook[]): Promise<void> {
  try {
    const db = await openDatabase();
    await replaceStoreItems(db, STORE_NOTEBOOKS, notebooks);
    db.close();
  } catch {
    try {
      const raw = localStorage.getItem(LS_FALLBACK_KEY);
      const current = raw ? JSON.parse(raw) : { notes: DEFAULT_NOTES };
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify({ ...current, notebooks }));
    } catch {
      // ignore quota errors
    }
  }
}
