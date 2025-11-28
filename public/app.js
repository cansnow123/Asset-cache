(() => {
  const state = { type: '', q: '', limit: 200 }

  const elList = document.getElementById('list')
  const elStats = document.getElementById('stats')
  const elSearch = document.getElementById('search')
  const elRefresh = document.getElementById('refresh')
  const segBtns = Array.from(document.querySelectorAll('.seg-btn'))
  const elSortBy = document.getElementById('sortBy')
  const elOrder = document.getElementById('order')
  const elPageSize = document.getElementById('pageSize')
  const elTimeRange = document.getElementById('timeRange')
  const elSentinel = document.getElementById('sentinel')
  const elBackTop = document.getElementById('backTop')

  /**
   * 格式化字节大小为易读文本
   * @param {number} n 字节数
   * @returns {string}
   */
  const fmtSize = n => {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  /**
   * 将毫秒时间戳格式化为本地时间字符串
   * @param {number} ms 毫秒
   * @returns {string}
   */
  const fmtTime = ms => new Date(ms).toLocaleString()

  /**
   * 复制文本到剪贴板
   * @param {string} text 文本
   * @returns {Promise<void>}
   */
  const copy = async text => {
    try {
      await navigator.clipboard.writeText(text)
      toast('已复制到剪贴板')
    } catch (e) {
      console.error(e)
      toast('复制失败，请手动选择复制', true)
    }
  }

  let toastTimer
  /**
   * 显示轻提示
   * @param {string} msg 提示内容
   * @param {boolean} warn 是否警示样式
   */
  const toast = (msg, warn) => {
    let t = document.querySelector('.toast')
    if (!t) {
      t = document.createElement('div')
      t.className = 'toast'
      document.body.appendChild(t)
    }
    t.textContent = msg
    t.style.background = warn ? 'rgba(255,96,96,0.9)' : 'rgba(108,140,255,0.9)'
    t.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800)
  }

  /**
   * 渲染缓存条目，仅展示完整URL与操作
   * @param {Array<{type:string,url:string,size:number,mtime:number}>} items 列表
   */
  /**
   * 渲染缓存条目，仅展示完整URL与操作
   * - 维持最大 DOM 节点数量，超量时自动移除顶部旧节点（轻量虚拟化）
   * @param {Array<{type:string,url:string,size:number,mtime:number,name?:string,version?:string}>} items 列表
   */
  const renderItems = items => {
    elList.innerHTML = ''
    if (!items.length) {
      elList.innerHTML = '<div class="empty">暂无数据</div>'
      return
    }
    const frag = document.createDocumentFragment()
    for (const it of items) {
      const card = document.createElement('div')
      card.className = 'item'
      card.innerHTML = `
        <div class="row">
          <span class="badge ${it.type}">${it.type.toUpperCase()}</span>
          <span class="url" title="${it.url}">${it.url}</span>
        </div>
        <div class="meta">
          <span>${fmtSize(it.size)}</span>
          <span>${fmtTime(it.mtime)}</span>
        </div>
        <div class="actions">
          <button class="btn small" data-act="copy-url">复制完整URL</button>
          <a class="btn small" href="${it.url}" target="_blank">打开</a>
        </div>
      `
      card.querySelector('[data-act="copy-url"]').addEventListener('click', () => copy(it.url))
      frag.appendChild(card)
    }
    elList.appendChild(frag)
  }

  /**
   * 加载缓存列表数据并更新视图
   * @returns {Promise<void>}
   */
  /**
   * 加载缓存列表数据并更新视图（分页 + 过滤 + 排序）
   * - 支持增量加载，当页码递增时附加到列表
   * @param {boolean} reset 是否重置列表
   * @returns {Promise<void>}
   */
  let loading = false
  let page = 1
  let pageSize = Number(elPageSize.value || 30)
  let hasMore = true
  let itemsBuf = []
  const load = async (reset = false) => {
    if (loading) return
    if (reset) { page = 1; itemsBuf = []; elList.innerHTML = ''; hasMore = true }
    if (!hasMore && !reset) return
    loading = true
    elStats.textContent = '加载中...'
    const u = new URL('/api/list-cache', location.origin)
    if (state.type) u.searchParams.set('type', state.type)
    if (state.q) u.searchParams.set('q', state.q)
    const now = Date.now()
    const hours = Number(elTimeRange.value || 0)
    if (hours > 0) u.searchParams.set('updatedFrom', String(now - hours * 3600 * 1000))
    u.searchParams.set('sortBy', elSortBy.value)
    u.searchParams.set('order', elOrder.value)
    u.searchParams.set('page', String(page))
    u.searchParams.set('pageSize', String(pageSize))
    const r = await fetch(u)
    const data = await r.json()
    itemsBuf = reset ? (data.items || []) : itemsBuf.concat(data.items || [])
    hasMore = !!data.hasMore
    elStats.textContent = `共 ${data.total} 条，已加载 ${itemsBuf.length}${hasMore ? '（继续下拉加载）' : ''}`
    renderItems(itemsBuf)
    page += 1
    loading = false
  }

  // 事件绑定
  segBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      segBtns.forEach(b => b.classList.remove('is-active'))
      btn.classList.add('is-active')
      state.type = btn.dataset.type || ''
      load()
    })
  })
  elSearch.addEventListener('input', () => {
    state.q = elSearch.value.trim()
    load(true)
  })
  elSortBy.addEventListener('change', () => load(true))
  elOrder.addEventListener('change', () => load(true))
  elPageSize.addEventListener('change', () => { pageSize = Number(elPageSize.value || 30); load(true) })
  elTimeRange.addEventListener('change', () => load(true))
  elRefresh.addEventListener('click', async () => {
    try {
      const r = await fetch('/api/seed')
      const j = await r.json()
      toast(`Seed 完成：${j.count} 项`)
    } catch {}
    load(true)
  })

  // 轻量虚拟滚动：靠近底部即加载下一页；大量节点时隐藏返回顶部按钮控制
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) load(false)
    })
  })
  io.observe(elSentinel)

  // 返回顶部按钮展示与交互
  const onScroll = () => {
    const show = (document.documentElement.scrollTop || document.body.scrollTop) > 400
    elBackTop.classList.toggle('show', show)
  }
  window.addEventListener('scroll', onScroll)
  elBackTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })

  // 首次加载
  load(true)
})()
