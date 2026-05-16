// Production HTTP adapter for the TanStack Start build.
//
// Two responsibilities the Vite dev server / Nitro .output used to handle:
//   1. Serve static client assets from dist/client/  (JS/CSS/fonts/images)
//   2. Fall through to the SSR fetch handler (dist/server/server.js) for routes
//
// Without (1) the browser gets HTML for /assets/*.js → no hydration → dead UI.
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { stat, readFile } from 'node:fs/promises'
import { join, normalize, extname } from 'node:path'
import serverEntry from './dist/server/server.js'

const PORT = Number(process.env.PORT) || 3210
const HOST = process.env.HOST || '127.0.0.1'
const CLIENT_DIR = join(process.cwd(), 'dist', 'client')

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
}

const fetchHandler =
  typeof serverEntry?.fetch === 'function'
    ? serverEntry.fetch.bind(serverEntry)
    : typeof serverEntry?.default?.fetch === 'function'
      ? serverEntry.default.fetch.bind(serverEntry.default)
      : typeof serverEntry === 'function'
        ? serverEntry
        : null

if (!fetchHandler) {
  console.error('prod-server: could not resolve fetch handler')
  process.exit(1)
}

async function tryServeStatic(req, res, pathname) {
  // Only attempt for safe GET/HEAD; never traverse out of CLIENT_DIR.
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  if (clean.includes('\0')) return false
  const filePath = join(CLIENT_DIR, clean)
  if (!filePath.startsWith(CLIENT_DIR)) return false
  let st
  try {
    st = await stat(filePath)
  } catch {
    return false
  }
  if (!st.isFile()) return false
  const ext = extname(filePath).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  const body = await readFile(filePath)
  res.statusCode = 200
  res.setHeader('Content-Type', type)
  res.setHeader('Content-Length', body.length)
  // Hashed asset filenames → long cache; everything else short.
  // No immutable/1yr: a content-hashed asset that briefly served wrong content
  // (e.g. mid-deploy) would otherwise poison client caches permanently. 1h is
  // enough to amortise load while letting any bad cache self-heal fast.
  if (/-[A-Za-z0-9_]{8,}\.[a-z0-9]+$/.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=3600')
  } else {
    res.setHeader('Cache-Control', 'public, max-age=120')
  }
  res.end(req.method === 'HEAD' ? undefined : body)
  return true
}

const httpServer = createServer(async (req, res) => {
  const ac = new AbortController()
  res.on('close', () => ac.abort())
  try {
    const host = req.headers.host || `${HOST}:${PORT}`
    const u = new URL(req.url, `http://${host}`)

    // 1. Static client assets first.
    if (await tryServeStatic(req, res, u.pathname)) return

    // 2. SSR fetch handler.
    const HOP = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'])
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) {
      if (HOP.has(k.toLowerCase())) continue
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
      else if (v != null) headers.set(k, v)
    }
    const init = { method: req.method, headers, signal: ac.signal }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = Readable.toWeb(req)
      init.duplex = 'half'
    }
    const response = await fetchHandler(new Request(u.href, init))
    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      try { res.setHeader(key, value) } catch {}
    })
    if (response.body) Readable.fromWeb(response.body).pipe(res)
    else res.end(await response.text())
  } catch (err) {
    if (ac.signal.aborted) { try { res.end() } catch {} ; return }
    console.error('prod-server request error:', err?.stack || err)
    if (!res.headersSent) res.statusCode = 500
    try { res.end('Internal Server Error') } catch {}
  }
})

httpServer.listen(PORT, HOST, () =>
  console.log(`prod-server: TanStack Start build on http://${HOST}:${PORT} (static=${CLIENT_DIR})`),
)
