// Custom server wrapper that serves static files + Next.js standalone
const http = require('http')
const fs = require('fs')
const path = require('path')

const STATIC_DIR = path.join(__dirname, '.next', 'static')
const PUBLIC_DIR = path.join(__dirname, 'public')

const MIME_TYPES = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.map': 'application/json',
  '.txt': 'text/plain',
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath)
  const mime = MIME_TYPES[ext] || 'application/octet-stream'
  
  try {
    if (!fs.existsSync(filePath)) return false
    const data = fs.readFileSync(filePath)
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    res.end(data)
    return true
  } catch {
    return false
  }
}

// Start the Next.js standalone server on an internal port
const NEXT_PORT = 3001
process.env.PORT = String(NEXT_PORT)
process.env.HOSTNAME = '127.0.0.1'
require('./.next/standalone/server.js')

// Proxy server on the public port
const PUBLIC_PORT = parseInt(process.env.MC_PORT || '3000', 10)

const proxy = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PUBLIC_PORT}`)

  // Serve /_next/static/* from filesystem
  if (url.pathname.startsWith('/_next/static/')) {
    const relPath = url.pathname.replace('/_next/static/', '')
    const filePath = path.join(STATIC_DIR, relPath)
    if (serveFile(filePath, res)) return
  }

  // Serve /public/* from filesystem
  if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/_next/')) {
    const filePath = path.join(PUBLIC_DIR, url.pathname)
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      if (serveFile(filePath, res)) return
    }
  }

  // Proxy everything else to Next.js
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: NEXT_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: req.headers.host },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(res)
    }
  )

  proxyReq.on('error', (err) => {
    res.writeHead(502)
    res.end('Bad Gateway')
  })

  req.pipe(proxyReq)
})

proxy.listen(PUBLIC_PORT, '0.0.0.0', () => {
  console.log(`MC2 proxy listening on :${PUBLIC_PORT}, Next.js on :${NEXT_PORT}`)
})
