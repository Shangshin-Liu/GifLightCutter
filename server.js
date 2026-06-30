// GifLightCutter – 本機靜態伺服器（僅需 Node.js，無需安裝任何套件）
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.gif' : 'image/gif',
  '.mp4' : 'video/mp4',
  '.webm': 'video/webm',
  '.mov' : 'video/quicktime',
};

const server = http.createServer((req, res) => {
  // 去掉 query string
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);

  // 防止路徑穿越
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${urlPath}`);
      return;
    }

    const ext  = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      // ffmpeg.wasm 多執行緒版需要 SharedArrayBuffer，須加這兩個標頭
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🎬 GifLightCutter 已啟動');
  console.log(`  → 請開啟瀏覽器並前往：http://localhost:${PORT}`);
  console.log('  → 按 Ctrl+C 停止伺服器');
  console.log('');
});
