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
 * 从URL和内容类型判断目标保存路径与文件名（保留原URL目录层级）
 * @param {string} urlStr 请求的URL
 * @param {string|undefined} contentType 响应的Content-Type
 * @returns {{fullPath:string, folder:string, filename:string}}
 */
function resolveTargetPath(urlStr, contentType) {
  const u = new URL(urlStr)
  let base = path.basename(u.pathname)
  if (!base || base === '/') base = 'index'
  const ext = path.extname(base).toLowerCase()

  let folder
  let type
  if (ext === '.css') folder = CSS_DIR
  else if (ext === '.js') folder = JS_DIR
  else if (contentType) {
    const ct = (contentType || '').split(';')[0].trim()
    if (ct === 'text/css') folder = CSS_DIR
    else folder = JS_DIR
  } else {
    folder = JS_DIR
  }

  if (ext === '.css') type = 'css'
  else if (ext === '.js') type = 'js'
  else if ((contentType || '').split(';')[0].trim() === 'text/css') type = 'css'
  else type = 'js'

  // 按原URL路径的目录层级保存：/npm/bootstrap@5.3.0/dist/css → 子目录
  let subDir = path.dirname(u.pathname)
  if (subDir === '/' || subDir === '.') subDir = ''
  // 去掉URL起始斜杠与反斜杠，并剔除越权片段
  const raw = subDir.replace(/^\/+/, '').replace(/\\+/g, '/')
  const safeParts = raw
    .split('/')
    .filter(p => p && p !== '..')
  const normalized = safeParts.join('/')
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
  return safeParts.join('/')
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

  fs.writeFileSync(fullPath, Buffer.from(response.data))
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

// 静态服务：/css 与 /js 直接映射到缓存目录
app.use('/css', express.static(CSS_DIR, { maxAge: '365d', immutable: true }))
app.use('/js', express.static(JS_DIR, { maxAge: '365d', immutable: true }))

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

app.listen(PORT, () => {
  console.log(`Asset Cache Server listening on http://localhost:${PORT}`)
})