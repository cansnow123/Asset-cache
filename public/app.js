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
  const elSearchHint = document.getElementById('searchHint')
  const listContainer = document.querySelector('.list-container')

  // Mobile Sidebar Logic
  const toggleSidebar = document.getElementById('toggleSidebar')
  const sidebar = document.getElementById('sidebar')
  const sidebarOverlay = document.getElementById('sidebarOverlay')

  if (toggleSidebar && sidebar && sidebarOverlay) {
    const closeSidebar = () => {
      sidebar.classList.remove('open')
      sidebarOverlay.classList.remove('open')
    }
    toggleSidebar.addEventListener('click', () => {
      sidebar.classList.toggle('open')
      sidebarOverlay.classList.toggle('open')
    })
    sidebarOverlay.addEventListener('click', closeSidebar)
  }

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
    t.style.background = warn ? 'rgba(255,59,48,0.9)' : 'rgba(0,122,255,0.9)'
    t.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800)
  }

  /**
   * 渲染缓存条目
   * @param {Array<{type:string,url:string,size:number,mtime:number}>} items 列表
   */
  const renderItems = items => {
    elList.innerHTML = ''
    if (!items.length) {
      elList.innerHTML = '<div class="empty">暂无内容</div>'
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
          <button class="btn small outline" data-act="copy-url">复制链接</button>
          <a class="btn small primary" href="${it.url}" target="_blank">打开</a>
        </div>
      `
      card.querySelector('[data-act="copy-url"]').addEventListener('click', () => copy(it.url))
      frag.appendChild(card)
    }
    elList.appendChild(frag)
  }

  /**
   * 加载缓存列表数据并更新视图（分页 + 过滤 + 排序）
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
    
    // Manage spinner visibility
    const elSpinner = elSentinel.querySelector('.spinner')
    if (elSpinner) elSpinner.style.display = 'block'
    
    try {
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
      elStats.textContent = `共 ${data.total} 条，已加载 ${itemsBuf.length}`
      renderItems(itemsBuf)
      
      // Manage search hint visibility
      if (elSearchHint) {
         // Show hint if there is more data on server (hasMore) or simply if list is not empty (as requested)
         // Requirement: "Add explicit search function hint, guiding user to search to get more content"
         // If hasMore is true, it means we only showed a subset.
         // If itemsBuf.length < data.total, we are showing a subset.
         const isPartial = itemsBuf.length < data.total
         elSearchHint.style.display = (isPartial && !loading) ? 'block' : 'none'
      }

      page += 1
    } catch (e) {
      console.error(e)
      elStats.textContent = '加载失败'
      toast('加载失败', true)
    } finally {
      loading = false
      if (elSpinner) elSpinner.style.display = 'none'
    }
  }

  // 事件绑定
  segBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      segBtns.forEach(b => b.classList.remove('is-active'))
      btn.classList.add('is-active')
      state.type = btn.dataset.type || ''
      load(true)
    })
  })
  
  // 防抖搜索
  let searchTimer
  elSearch.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      state.q = elSearch.value.trim()
      load(true)
    }, 300)
  })

  elSortBy.addEventListener('change', () => load(true))
  elOrder.addEventListener('change', () => load(true))
  elPageSize.addEventListener('change', () => { pageSize = Number(elPageSize.value || 30); load(true) })
  elTimeRange.addEventListener('change', () => load(true))
  
  elRefresh.addEventListener('click', async () => {
    try {
      toast('刷新列表中...')
      // const r = await fetch('/api/seed')
      // const j = await r.json()
      // toast(`Seed 完成：${j.count} 项`)
    } catch {
      toast('请求失败', true)
    }
    load(true)
  })

  // 虚拟滚动/无限加载
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) load(false)
    })
  }, { root: listContainer, rootMargin: '100px' })
  
  io.observe(elSentinel)

  // 返回顶部按钮展示与交互
  const onScroll = () => {
    const show = listContainer.scrollTop > 400
    elBackTop.classList.toggle('show', show)
  }
  listContainer.addEventListener('scroll', onScroll)
  elBackTop.addEventListener('click', () => {
    listContainer.scrollTo({ top: 0, behavior: 'smooth' })
  })

  // 首次加载
  load(true)
})()
