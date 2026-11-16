import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Hydrate external image URLs copied in text/html into base64 data URLs
  // so pasted AI images persist offline in IndexedDB and export cleanly.
  app.post('/api/proxy-image', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl || (!rawUrl.startsWith('https://') && !rawUrl.startsWith('http://'))) {
      res.status(400).json({ error: 'Invalid image URL' });
      return;
    }

    try {
      const parsed = new URL(rawUrl);
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('172.')
      ) {
        res.status(403).json({ error: 'Local network URLs are not allowed' });
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(rawUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FolioNoteClipper/1.0)',
          Accept: 'image/*,*/*;q=0.8',
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        res.status(502).json({ error: `Upstream returned ${response.status}` });
        return;
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      if (!contentType.startsWith('image/')) {
        res.status(415).json({ error: 'URL did not return an image' });
        return;
      }

      const arrayBuf = await response.arrayBuffer();
      if (arrayBuf.byteLength > 10 * 1024 * 1024) {
        res.status(413).json({ error: 'Image exceeds 10MB limit' });
        return;
      }

      const base64 = Buffer.from(arrayBuf).toString('base64');
      const mime = contentType.split(';')[0].trim();
      res.json({
        dataUrl: `data:${mime};base64,${base64}`,
        mimeType: mime,
      });
    } catch {
      res.status(502).json({ error: 'Failed to fetch image' });
    }
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Folio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
