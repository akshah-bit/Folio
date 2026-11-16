import JSZip from 'jszip';
import type { Note, NoteAsset } from '../types/note';

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'folio-note'
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function resolveAssetBytes(asset: NoteAsset): Promise<{ bytes: Uint8Array; ext: string }> {
  if (asset.dataUrl.startsWith('data:')) {
    const [header, data] = asset.dataUrl.split(',');
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : asset.mimeType || 'image/png';
    const ext = mime.includes('svg')
      ? 'svg'
      : mime.includes('jpeg') || mime.includes('jpg')
        ? 'jpg'
        : mime.includes('webp')
          ? 'webp'
          : 'png';

    if (header.includes(';base64')) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { bytes, ext };
    }
    const decoded = decodeURIComponent(data);
    return { bytes: new TextEncoder().encode(decoded), ext };
  }

  // Fallback: fetch local or relative asset path (e.g. /src/assets/images/*.jpg)
  const resp = await fetch(asset.dataUrl);
  const buf = await resp.arrayBuffer();
  const ext = asset.name.split('.').pop() || 'jpg';
  return { bytes: new Uint8Array(buf), ext };
}

export function buildPortableMarkdown(note: Note): string {
  const header = [
    `# ${note.title}`,
    '',
    `> Source: ${note.sourcePlatform} · Updated: ${new Date(note.updatedAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`,
    '',
  ].join('\n');

  let md = note.markdown;
  for (const [id, asset] of Object.entries(note.assets)) {
    const safeName = asset.name.replace(/[^a-z0-9._-]/gi, '_');
    md = md.replaceAll(`folio-asset://${id}`, `./assets/${safeName}`);
  }
  return `${header}${md}\n`;
}

export async function exportNoteAsMarkdownZip(note: Note): Promise<void> {
  const zip = new JSZip();
  const slug = slugify(note.title);
  const assetsFolder = zip.folder('assets');

  let portableMd = `# ${note.title}\n\n`;
  let body = note.markdown;

  const entries = Object.entries(note.assets);
  for (let i = 0; i < entries.length; i++) {
    const [id, asset] = entries[i];
    try {
      const { bytes, ext } = await resolveAssetBytes(asset);
      const baseName = asset.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]/gi, '-');
      const fileName = `${baseName || `image-${i + 1}`}.${ext}`;
      assetsFolder?.file(fileName, bytes);
      body = body.replaceAll(`folio-asset://${id}`, `./assets/${fileName}`);
    } catch {
      // keep reference if asset could not be fetched
    }
  }

  portableMd += body;
  zip.file(`${slug}.md`, portableMd);

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${slug}.zip`);
}

export async function exportNoteAsPortableHtml(note: Note, renderedHtml: string): Promise<void> {
  const slug = slugify(note.title);
  let htmlBody = renderedHtml;

  // Inline any local assets as base64 data URLs so the HTML opens offline anywhere
  for (const asset of Object.values(note.assets)) {
    if (!asset.dataUrl.startsWith('data:')) {
      try {
        const { bytes, ext } = await resolveAssetBytes(asset);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) {
          bin += String.fromCharCode(bytes[i]);
        }
        const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const dataUri = `data:${mime};base64,${btoa(bin)}`;
        htmlBody = htmlBody.replaceAll(asset.dataUrl, dataUri);
      } catch {
        // leave url intact if fetch fails
      }
    }
  }

  const docHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${note.title.replace(/</g, '&lt;')}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 820px; margin: 48px auto; padding: 0 24px; color: #0f172a; line-height: 1.7; }
    h1 { font-size: 2rem; margin-bottom: 0.25rem; }
    .meta { color: #64748b; font-size: 0.875rem; margin-bottom: 2rem; }
    pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; overflow-x: auto; font-size: 0.875rem; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    table { width: 100%; border-collapse: collapse; margin: 1.25rem 0; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
    th { background: #f8fafc; }
    img { max-width: 100%; height: auto; border-radius: 8px; border: 1px solid #e2e8f0; margin: 1rem 0; }
    blockquote { border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 8px; padding: 12px 16px; margin: 1rem 0; color: #475569; }
  </style>
</head>
<body>
  <h1>${note.title.replace(/</g, '&lt;')}</h1>
  <div class="meta">Source: ${note.sourcePlatform} · Saved with Folio</div>
  ${htmlBody}
</body>
</html>`;

  triggerDownload(new Blob([docHtml], { type: 'text/html;charset=utf-8' }), `${slug}.html`);
}

export function exportWorkspaceBackupJson(notes: Note[]): void {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), notes }, null, 2);
  triggerDownload(
    new Blob([payload], { type: 'application/json;charset=utf-8' }),
    `folio-backup-${new Date().toISOString().slice(0, 10)}.json`
  );
}
