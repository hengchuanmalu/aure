// Serve the production build plus opt-in test media. Fixtures never enter dist
// or the packaged desktop app. This server is for local/CI browser acceptance.
import { preview } from 'vite';
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const media = fileURLToPath(new URL('../tests/fixtures/media/', import.meta.url));
const files = new Set(readdirSync(media));
await preview({
  preview: { host: '127.0.0.1', port: 1421, strictPort: true },
  plugins: [{
    name: 'acceptance-fixtures',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/tests\/fixtures\/media\/([a-z0-9.-]+\.(?:jpg|mp4))(?:\?.*)?$/i.exec(request.url || '');
        if (!match || !files.has(match[1]) || !['GET', 'HEAD'].includes(request.method)) return next();
        const file = join(media, match[1]);
        const size = statSync(file).size;
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
        const start = range ? Number(range[1]) : 0;
        const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start > end || start >= size) {
          response.writeHead(416, { 'Content-Range': `bytes */${size}` });
          return response.end();
        }
        response.writeHead(range ? 206 : 200, {
          'Content-Type': file.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
          'Content-Length': end - start + 1,
          'Accept-Ranges': 'bytes',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
        });
        if (request.method === 'HEAD') return response.end();
        createReadStream(file, { start, end }).on('error', error => response.destroy(error)).pipe(response);
      });
    },
  }],
});
console.log('Production browser acceptance: http://127.0.0.1:1421 (test fixtures supplied separately)');
