import 'dotenv/config'
import express from 'express'
import axios from 'axios'
import morgan from 'morgan'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = Number(process.env.PORT || 3000)
const CACHE_ROOT = path.join(__dirname, 'cache')
const CSS_DIR = path.join(CACHE_ROOT, 'css')
const JS_DIR = path.join(CACHE_ROOT, 'js')
const SEED_FILE = path.join(__dirname, 'seed.txt')
const PUBLIC_DIR = path.join(__dirname, 'public')

// 中间件
app.use(express.json({ limit: '2mb' }))
app.use(morgan('tiny'))
app.set('trust proxy', true)

/**
 * 创建必要的缓存目录
 * @returns {void}
 */
function ensureCacheDirs() {
  if (!fs.existsSync(CACHE_ROOT)) fs.mkdirSync(CACHE_ROOT)
  if (!fs.existsSync(CSS_DIR)) fs.mkdirSync(CSS_DIR)
  if (!fs.existsSync(JS_DIR)) fs.mkdirSync(JS_DIR)
}

/**
 * 注册前端首页与公共静态目录
 * - 将 `public/` 作为静态资源根目录
 * - 在根路径 `/` 提供首页 `index.html`
 * @param {import('express').Express} app 实例
 * @returns {void}
 */
function registerPublicHomepage(app) {
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR)
  app.use(express.static(PUBLIC_DIR, {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (path.extname(filePath) === '.html') {
        res.setHeader('Cache-Control', 'no-cache')
      }
    }
  }))
  app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-cache')
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'))
  })
}

/**
 * 从URL和内容类型判断目标保存路径与文件名（保留原URL目录层级）
 * @param {string} urlStr 请求的URL
 * @param {string|undefined} contentType 响应的Content-Type
 * @returns {{fullPath:string, folder:string, filename:string}}
 */
function resolveTargetPath(urlStr, contentType) {
  const u = new URL(urlStr)
  let base = path.basename(u.pathname)
  if (!base || base === '/') base = 'index'
  let ext = path.extname(base).toLowerCase()

  let folder
  let type
  if (ext === '.css') folder = CSS_DIR
  else if (ext === '.js') folder = JS_DIR
  else if (['.woff', '.woff2', '.ttf', '.otf', '.eot', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) folder = CSS_DIR
  else if (contentType) {
    const ct = (contentType || '').split(';')[0].trim()
    if (ct === 'text/css') folder = CSS_DIR
    else if (ct.startsWith('font/') || ct.startsWith('image/')) folder = CSS_DIR
    else folder = JS_DIR
  } else {
    folder = JS_DIR
  }

  if (ext === '.css') type = 'css'
  else if (ext === '.js') type = 'js'
  else if ((contentType || '').split(';')[0].trim() === 'text/css') type = 'css'
  else type = 'js'

  // 无扩展名时根据判定类型补全扩展名，确保同一URL在抓取前后路径一致
  if (!ext) {
    if (type === 'css') { base = `${base}.css`; ext = '.css' }
    else { base = `${base}.js`; ext = '.js' }
  }

  // 按原URL路径的目录层级保存：/npm/bootstrap@5.3.0/dist/css → 子目录
  let subDir = path.dirname(u.pathname)
  if (subDir === '/' || subDir === '.') subDir = ''
  // 去掉URL起始斜杠与反斜杠，并剔除越权片段
  const raw = subDir.replace(/^\/+/, '').replace(/\\+/g, '/')
  const safeParts = raw
    .split('/')
    .filter(p => p && p !== '..')
  let normalized = safeParts.join('/')
  if (!normalized) normalized = u.hostname
  const targetDir = normalized ? path.join(folder, normalized) : folder

  let fullPath = path.join(targetDir, base)
  // 防越权：若解析后不在目标根内，回退到根目录
  const resolved = path.resolve(fullPath)
  const rootResolved = path.resolve(folder)
  if (!resolved.startsWith(rootResolved)) {
    fullPath = path.join(rootResolved, base)
  }
  return { fullPath, folder: targetDir, filename: base, type }
}

/**
 * 计算适用于CSS依赖资源的保存路径（统一落在 CSS_DIR 下）
 * @param {string} urlStr 依赖资源的绝对URL
 * @returns {{fullPath:string, folder:string, filename:string}}
 */
function resolveAssetPathForCss(urlStr) {
  const u = new URL(urlStr)
  let base = path.basename(u.pathname)
  if (!base || base === '/') base = 'index'
  let subDir = path.dirname(u.pathname)
  if (subDir === '/' || subDir === '.') subDir = ''
  const raw = subDir.replace(/^\/+/, '').replace(/\\+/g, '/')
  const safeParts = raw.split('/').filter(p => p && p !== '..')
  let normalized = safeParts.join('/')
  if (!normalized) normalized = u.hostname
  const targetDir = normalized ? path.join(CSS_DIR, normalized) : CSS_DIR
  let fullPath = path.join(targetDir, base)
  const resolved = path.resolve(fullPath)
  const rootResolved = path.resolve(CSS_DIR)
  if (!resolved.startsWith(rootResolved)) {
    fullPath = path.join(rootResolved, base)
  }
  return { fullPath, folder: targetDir, filename: base }
}

/**
 * 提取CSS中的url(...)依赖列表（过滤data:等内联资源）
 * @param {string} cssText CSS文本内容
 * @returns {string[]}
 */
function extractCssUrls(cssText) {
  const out = []
  const re = /url\(\s*(["'])?([^"')]+)\1\s*\)/g
  let m
  while ((m = re.exec(cssText)) !== null) {
    const href = (m[2] || '').trim()
    if (!href || href.startsWith('data:')) continue
    out.push(href)
  }
  return Array.from(new Set(out))
}

/**
 * 在保存CSS后，按相对路径抓取其依赖资源（如字体、图片）
 * @param {string} baseUrl CSS源的绝对URL
 * @param {Buffer} cssBuf CSS二进制内容
 * @returns {Promise<void>}
 */
async function fetchCssDependencies(baseUrl, cssBuf) {
  const cssText = cssBuf.toString('utf8')
  const refs = extractCssUrls(cssText)
  if (refs.length === 0) return
  const base = new URL(baseUrl)
  // 计算CSS对应的本地子目录（保持与源路径层级一致）
  let subDir = path.dirname(base.pathname)
  if (subDir === '/' || subDir === '.') subDir = ''
  const raw = subDir.replace(/^\/+/, '').replace(/\\+/g, '/')
  const safeParts = raw.split('/').filter(p => p && p !== '..')
  let normalized = safeParts.join('/')
  if (!normalized) normalized = base.hostname
  const targetDir = normalized ? path.join(CSS_DIR, normalized) : CSS_DIR
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })

  // 回退候选源（dist路径包含前缀 css/npm/...，其他公共CDN通常为 npm/...）
  function buildFallbacks(absUrl) {
    try {
      const u = new URL(absUrl)
      const m = u.pathname.match(/\/(?:css\/)?npm\/([^/]+@[^/]+)\/(.+)/)
      if (m) {
        const pkg = m[1]
        const rest = m[2]
        return [
          `https://cdn.jsdelivr.net/npm/${pkg}/${rest}`,
          `https://unpkg.com/${pkg}/${rest}`
        ]
      }
    } catch {}
    return []
  }

  for (const rel of refs) {
    // 归一化相对路径，计算本地写入位置
    const relSafe = rel.replace(/\\+/g, '/').replace(/^\/+/, '')
    const relParts = relSafe.split('/').filter(p => p && p !== '..')
    const localPath = path.join(targetDir, ...relParts)
    const localDir = path.dirname(localPath)
    if (fs.existsSync(localPath)) continue
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true })

    // 依次尝试：原始源、回退源
    const primary = new URL(rel, baseUrl).toString()
    const candidates = [primary, ...buildFallbacks(primary)]
    let saved = false
    for (const c of candidates) {
      try {
        const resp = await axios.get(c, { responseType: 'arraybuffer', timeout: 20000, headers: { 'User-Agent': 'AssetCache/1.0', 'Accept': '*/*' } })
        fs.writeFileSync(localPath, Buffer.from(resp.data))
        saved = true
        break
      } catch {}
    }
    // 失败则跳过，避免影响主流程
    if (!saved) {
      // no-op
    }
  }
}

/**
 * 从URL提取并净化子目录（与保存逻辑一致），用于构造公开访问路径
 * @param {string} urlStr 远程资源URL
 * @returns {string} 规范化子目录（可能为空字符串）
 */
function sanitizeSubdirFromUrl(urlStr) {
  const u = new URL(urlStr)
  let subDir = path.dirname(u.pathname)
  if (subDir === '/' || subDir === '.') subDir = ''
  const raw = subDir.replace(/^\/+/, '').replace(/\\+/g, '/')
  const safeParts = raw.split('/').filter(p => p && p !== '..')
  const joined = safeParts.join('/')
  return joined ? joined : u.hostname
}

/**
 * 计算公开路径（/css 或 /js 下的相对路径）
 * @param {string} urlStr 远程资源URL
 * @param {'css'|'js'} type 资源类型
 * @param {string} filename 保存的文件名
 * @returns {string} 相对公开路径，如 /css/npm/.../file.css
 */
function getPublicPath(urlStr, type, filename) {
  const prefix = type === 'css' ? '/css' : '/js'
  const sub = sanitizeSubdirFromUrl(urlStr)
  return sub ? `${prefix}/${sub}/${filename}` : `${prefix}/${filename}`
}

/**
 * 构造完整可访问URL（含协议与主机）
 * @param {import('express').Request} req 请求对象
 * @param {string} urlStr 源URL
 * @param {'css'|'js'} type 类型
 * @param {string} filename 文件名
 * @returns {string} 完整URL
 */
function buildAccessUrl(req, urlStr, type, filename) {
  const host = req.get('host')
  const proto = req.protocol
  const rel = getPublicPath(urlStr, type, filename)
  return `${proto}://${host}${rel}`
}

/**
 * 抓取远程文件并保存到本地缓存目录（带去重）
 * @param {string} urlStr 远程资源URL
 * @returns {Promise<{url:string, saved:string, size:number, type:'css'|'js', skipped:boolean}>}
 */
async function fetchAndStore(urlStr) {
  // 先按扩展名推导目标路径，若文件已存在则跳过抓取
  const pre = resolveTargetPath(urlStr, undefined)
  if (fs.existsSync(pre.fullPath)) {
    const stat = fs.statSync(pre.fullPath)
    // 若已存在且为CSS，仍尝试解析并抓取依赖资源
    if (pre.type === 'css') {
      try {
        const buf = fs.readFileSync(pre.fullPath)
        await fetchCssDependencies(urlStr, buf)
      } catch {}
    }
    return { url: urlStr, saved: pre.filename, size: stat.size, type: pre.type, skipped: true }
  }

  const response = await axios.get(urlStr, {
    responseType: 'arraybuffer',
    timeout: 20000,
    headers: {
      'User-Agent': 'AssetCache/1.0',
      'Accept': 'text/css, application/javascript, */*'
    }
  })

  const contentType = response.headers['content-type'] || ''
  const { fullPath, folder, filename, type } = resolveTargetPath(urlStr, contentType)
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true })

  const buf = Buffer.from(response.data)
  fs.writeFileSync(fullPath, buf)
  if (type === 'css') {
    await fetchCssDependencies(urlStr, buf)
  }
  const stat = fs.statSync(fullPath)
  return { url: urlStr, saved: filename, size: stat.size, type, skipped: false }
}

/**
 * 解析TXT文本内容为URL列表
 * @param {string} txt TXT文件内容
 * @returns {string[]}
 */
function parseTxtToUrls(txt) {
  return txt
    .split(/\r?\n/) 
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('#'))
}

/**
 * 批量抓取URL列表并返回结果
 * @param {string[]} urls URL数组
 * @returns {Promise<Array<{url:string, saved:string, size:number, type:'css'|'js'}>>}
 */
async function batchFetch(urls) {
  const results = []
  for (const url of urls) {
    try {
      const r = await fetchAndStore(url)
      results.push(r)
    } catch (err) {
      results.push({ url, saved: '', size: 0, type: 'js', skipped: false, error: err.message })
    }
  }
  return results
}

ensureCacheDirs()
registerPublicHomepage(app)

// 静态服务：/css 与 /js 直接映射到缓存目录
app.use('/css', express.static(CSS_DIR, {
  maxAge: '365d',
  immutable: true
}))
app.use('/js', express.static(JS_DIR, {
  maxAge: '365d',
  immutable: true
}))

// 健康检查
app.get('/health', (req, res) => {
  res.json({ ok: true })
})

// 已移除外部提交接口：/api/upload-txt 与 /api/cache

/**
 * 从项目内置 seed.txt 加载URL并执行批量缓存
 * @returns {Promise<{count:number, results:any[]}>}
 */
async function runSeedFromFile() {
  if (!fs.existsSync(SEED_FILE)) {
    return { count: 0, results: [] }
  }
  const txt = fs.readFileSync(SEED_FILE, 'utf8')
  const urls = parseTxtToUrls(txt)
  if (urls.length === 0) return { count: 0, results: [] }
  const results = await batchFetch(urls)
  return { count: results.length, results }
}

// 触发内置seed.txt抓取
app.get('/api/seed', async (req, res) => {
  try {
    const r = await runSeedFromFile()
    const mapped = (r.results || []).map(x => ({
      url: x.url,
      saved: x.saved ? getPublicPath(x.url, x.type, x.saved) : '',
      accessUrl: x.saved ? buildAccessUrl(req, x.url, x.type, x.saved) : '',
      size: x.size,
      type: x.type,
      skipped: x.skipped,
      error: x.error,
      filename: x.saved
    }))
    res.json({ count: mapped.length, results: mapped })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * 递归遍历目录并返回文件信息列表
 * @param {string} rootDir 根目录
 * @returns {{abs:string, rel:string, size:number, mtime:number}[]} 文件信息
 */
function walkFiles(rootDir) {
  /** @type {{abs:string, rel:string, size:number, mtime:number}[]} */
  const out = []
  const stack = [rootDir]
  while (stack.length) {
    const dir = stack.pop()
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        stack.push(abs)
      } else if (e.isFile()) {
        const stat = fs.statSync(abs)
        const rel = path.relative(rootDir, abs).replace(/\\/g, '/')
        out.push({ abs, rel, size: stat.size, mtime: stat.mtimeMs })
      }
    }
  }
  return out
}

/**
 * 从相对路径中提取库元数据（兼容常见CDN目录结构）
 * 支持模式：
 * - npm/<name>@<version>/...
 * - ajax/libs/<name>/<version>/...
 * - gh/<org>/<repo>@<version>/...
 * - 任意片段含 <name>@<version>
 * @param {string} rel 相对路径（以缓存根为基准）
 * @returns {{name:string, version:string, ext:string, category:string}}
 */
function extractMetaFromRel(rel) {
  const ext = (path.extname(rel) || '').toLowerCase()
  const parts = rel.split('/').filter(Boolean)
  let name = ''
  let version = ''

  const idxNpm = parts.indexOf('npm')
  if (idxNpm >= 0 && parts[idxNpm + 1]) {
    const seg = parts[idxNpm + 1]
    const at = seg.indexOf('@')
    if (at > 0) {
      name = seg.slice(0, at)
      version = seg.slice(at + 1)
    }
  }

  if (!name) {
    const idxAjax = parts.indexOf('ajax')
    const idxLibs = parts.indexOf('libs')
    if (idxAjax >= 0 && idxLibs === idxAjax + 1 && parts[idxLibs + 1] && parts[idxLibs + 2]) {
      name = parts[idxLibs + 1]
      version = parts[idxLibs + 2]
    }
  }

  if (!name) {
    const idxGh = parts.indexOf('gh')
    if (idxGh >= 0 && parts[idxGh + 1]) {
      const seg = parts[idxGh + 1]
      const at = seg.indexOf('@')
      if (at > 0) {
        name = seg.slice(0, at)
        version = seg.slice(at + 1)
      }
    }
  }

  if (!name) {
    for (const seg of parts) {
      const at = seg.indexOf('@')
      if (at > 0) {
        name = seg.slice(0, at)
        version = seg.slice(at + 1)
        break
      }
    }
  }

  const category = name || (ext === '.css' ? 'css' : 'js')
  return { name, version, ext, category }
}

/**
 * 列出已缓存的 CSS/JS 文件，支持过滤与限制
 * 查询参数：
 * - type: 'css'|'js'（可选）
 * - q: 关键字（可选，匹配路径片段）
 * - name: 库名称（可选，匹配解析出的名称）
 * - updatedFrom/updatedTo: 时间戳毫秒（可选）
 * - sortBy: 'mtime'|'name'|'size'（默认 'mtime'）
 * - order: 'asc'|'desc'（默认 'desc'）
 * - page: 页码（默认 1）
 * - pageSize: 每页条数（默认 30，范围 20–50）
 * @param {import('express').Request} req 请求
 * @param {import('express').Response} res 响应
 * @returns {void}
 */
app.get('/api/list-cache', (req, res) => {
  const type = (req.query.type || '').toString().toLowerCase()
  const q = (req.query.q || '').toString().trim()
  const nameQ = (req.query.name || '').toString().trim().toLowerCase()
  const updatedFrom = Number(req.query.updatedFrom || 0) || undefined
  const updatedTo = Number(req.query.updatedTo || 0) || undefined
  const sortBy = ((req.query.sortBy || 'mtime') + '').toLowerCase()
  const order = ((req.query.order || 'desc') + '').toLowerCase() === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Number(req.query.page || 1))
  const pageSizeRaw = Number(req.query.pageSize || 30)
  const pageSize = Math.max(20, Math.min(50, isNaN(pageSizeRaw) ? 30 : pageSizeRaw))

  const host = req.get('host')
  const proto = req.protocol

  const cssFiles = walkFiles(CSS_DIR).map(f => {
    const meta = extractMetaFromRel(f.rel)
    return {
    type: 'css',
    path: `/css/${f.rel}`,
    url: `${proto}://${host}/css/${f.rel}`,
    size: f.size,
    mtime: f.mtime,
    name: meta.name,
    version: meta.version,
    ext: meta.ext,
    category: meta.category
  }
  })
  const jsFiles = walkFiles(JS_DIR).map(f => {
    const meta = extractMetaFromRel(f.rel)
    return {
    type: 'js',
    path: `/js/${f.rel}`,
    url: `${proto}://${host}/js/${f.rel}`,
    size: f.size,
    mtime: f.mtime,
    name: meta.name,
    version: meta.version,
    ext: meta.ext,
    category: meta.category
  }
  })

  let items = [...cssFiles, ...jsFiles]
  if (type === 'css' || type === 'js') items = items.filter(i => i.type === type)
  if (q) items = items.filter(i => i.path.includes(q))
  if (nameQ) items = items.filter(i => (i.name || '').toLowerCase().includes(nameQ))
  if (updatedFrom) items = items.filter(i => i.mtime >= updatedFrom)
  if (updatedTo) items = items.filter(i => i.mtime <= updatedTo)

  const cmp = {
    mtime: (a, b) => a.mtime - b.mtime,
    name: (a, b) => (a.name || '').localeCompare(b.name || ''),
    size: (a, b) => a.size - b.size
  }[sortBy] || ((a, b) => a.mtime - b.mtime)
  items.sort((a, b) => (order === 'asc' ? cmp(a, b) : -cmp(a, b)))

  const total = items.length
  const start = (page - 1) * pageSize
  const sliced = items.slice(start, start + pageSize)

  res.json({
    count: sliced.length,
    total,
    page,
    pageSize,
    hasMore: start + pageSize < total,
    items: sliced
  })
})

app.listen(PORT, () => {
  console.log(`Asset Cache Server listening on http://localhost:${PORT}`)
})
