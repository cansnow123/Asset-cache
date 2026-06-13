(() => {
  const state = {
    type: '',
    q: '',
    loading: false,
    page: 1,
    pageSize: 30,
    hasMore: true,
    items: [],
    total: 0,
    lastUpdated: 0,
    lastSeedMessage: '等待操作'
  }

  const elList = document.getElementById('list')
  const elStats = document.getElementById('stats')
  const elSearch = document.getElementById('search')
  const elRefresh = document.getElementById('refresh')
  const elSortBy = document.getElementById('sortBy')
  const elOrder = document.getElementById('order')
  const elPageSize = document.getElementById('pageSize')
  const elTimeRange = document.getElementById('timeRange')
  const elSentinel = document.getElementById('sentinel')
  const elBackTop = document.getElementById('backTop')
  const elSearchHint = document.getElementById('searchHint')
  const elSeedTrigger = document.getElementById('seedTrigger')
  const elLoadMore = document.getElementById('loadMore')
  const listContainer = document.querySelector('.list-container')
  const segBtns = Array.from(document.querySelectorAll('.seg-btn'))

  const toggleSidebar = document.getElementById('toggleSidebar')
  const sidebar = document.getElementById('sidebar')
  const sidebarOverlay = document.getElementById('sidebarOverlay')

  const heroTotal = document.getElementById('heroTotal')
  const heroUpdated = document.getElementById('heroUpdated')
  const heroView = document.getElementById('heroView')
  const heroSeedState = document.getElementById('heroSeedState')
  const summaryLoaded = document.getElementById('summaryLoaded')
  const summaryFilter = document.getElementById('summaryFilter')
  const summaryKeyword = document.getElementById('summaryKeyword')

  let toastTimer = null
  let searchTimer = null
  let seedDebounceTimer = null
  let seedSpinnerTimer = null
  let seedPollTimer = null
  let seedBusy = false

  const closeSidebar = () => {
    if (!sidebar || !sidebarOverlay) return
    sidebar.classList.remove('open')
    sidebarOverlay.classList.remove('open')
  }

  if (toggleSidebar && sidebar && sidebarOverlay) {
    toggleSidebar.addEventListener('click', () => {
      sidebar.classList.toggle('open')
      sidebarOverlay.classList.toggle('open')
    })
    sidebarOverlay.addEventListener('click', closeSidebar)
  }

  const formatSize = number => {
    if (number < 1024) return `${number} B`
    if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`
    if (number < 1024 * 1024 * 1024) return `${(number / (1024 * 1024)).toFixed(1)} MB`
    return `${(number / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const formatTime = ms => {
    if (!ms) return '暂无记录'
    return new Date(ms).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatRelativeFilter = () => {
    if (state.type === 'css') return 'CSS 资源'
    if (state.type === 'js') return 'JS 资源'
    return '全部资源'
  }

  const showToast = (message, type = 'info') => {
    let toast = document.querySelector('.toast')
    if (!toast) {
      toast = document.createElement('div')
      toast.className = 'toast'
      document.body.appendChild(toast)
    }
    toast.className = `toast ${type}`
    toast.textContent = message
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toast.classList.remove('show')
    }, 2200)
  }

  const copy = async text => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('链接已复制到剪贴板', 'success')
    } catch (error) {
      console.error(error)
      showToast('复制失败，请手动复制链接', 'warn')
    }
  }

  const setSeedLoading = isLoading => {
    if (!elSeedTrigger) return
    elSeedTrigger.classList.toggle('is-loading', isLoading)
    elSeedTrigger.disabled = isLoading
  }

  const updateSummary = () => {
    heroTotal.textContent = String(state.total)
    heroUpdated.textContent = formatTime(state.lastUpdated)
    heroView.textContent = formatRelativeFilter()
    heroSeedState.textContent = state.lastSeedMessage
    summaryLoaded.textContent = `${state.items.length} / ${state.total || 0}`
    summaryFilter.textContent = formatRelativeFilter()
    summaryKeyword.textContent = state.q || '未搜索'
  }

  const setStats = (text, isError = false) => {
    elStats.textContent = text
    elStats.style.color = isError ? 'var(--danger)' : 'var(--text-secondary)'
  }

  const renderEmpty = (title, description) => {
    elList.innerHTML = `
      <div class="empty-state">
        <h4>${title}</h4>
        <p>${description}</p>
      </div>
    `
  }

  const renderItems = items => {
    if (!items.length) {
      renderEmpty('暂无缓存资源', '可以先执行一次 Seed 抓取，或者调整筛选条件后再试。')
      return
    }

    const fragment = document.createDocumentFragment()
    items.forEach(item => {
      const card = document.createElement('article')
      card.className = 'item'

      const fileName = item.path.split('/').filter(Boolean).pop() || '未知文件'
      const name = item.name || fileName.replace(/\.(css|js)$/i, '')
      const version = item.version || ''
      const ext = item.ext || (item.type === 'css' ? '.css' : '.js')
      const versionMarkup = version
        ? `<span class="item-version">${version}</span>`
        : `<span class="meta-pill">文件<strong>${fileName}</strong></span>`

      card.innerHTML = `
        <div class="item-top">
          <span class="item-type ${item.type}">${item.type.toUpperCase()}</span>
          <div class="item-meta">
            <div class="item-title">
              <span class="item-name">${name}</span>
              ${versionMarkup}
              <span class="meta-pill">后缀<strong>${ext}</strong></span>
            </div>
            <p class="item-url">${item.url}</p>
          </div>
        </div>
        <div class="item-bottom">
          <div class="meta-group">
            <span class="meta-pill">文件大小<strong>${formatSize(item.size)}</strong></span>
            <span class="meta-pill">更新时间<strong>${formatTime(item.mtime)}</strong></span>
            <span class="meta-pill">分类<strong>${item.category || item.type}</strong></span>
          </div>
          <div class="item-actions">
            <button class="btn btn-secondary" type="button" data-action="copy">复制链接</button>
            <a class="btn btn-ghost" href="${item.url}" target="_blank" rel="noreferrer">打开资源</a>
          </div>
        </div>
      `

      const copyButton = card.querySelector('[data-action="copy"]')
      copyButton.addEventListener('click', () => copy(item.url))
      fragment.appendChild(card)
    })

    elList.innerHTML = ''
    elList.appendChild(fragment)
  }

  const updateHint = partial => {
    if (!elSearchHint) return
    elSearchHint.hidden = !partial
  }

  const updateLoadMore = () => {
    if (!elLoadMore) return
    const canLoadMore = state.hasMore && !state.loading
    elLoadMore.hidden = !state.hasMore
    elLoadMore.disabled = !canLoadMore
  }

  const buildListUrl = () => {
    const url = new URL('/api/list-cache', window.location.origin)
    if (state.type) url.searchParams.set('type', state.type)
    if (state.q) url.searchParams.set('q', state.q)
    if (elSortBy.value) url.searchParams.set('sortBy', elSortBy.value)
    if (elOrder.value) url.searchParams.set('order', elOrder.value)

    const hours = Number(elTimeRange.value || 0)
    if (hours > 0) {
      url.searchParams.set('updatedFrom', String(Date.now() - hours * 3600 * 1000))
    }

    url.searchParams.set('page', String(state.page))
    url.searchParams.set('pageSize', String(state.pageSize))
    return url
  }

  const load = async (reset = false) => {
    if (state.loading) return
    if (reset) {
      state.page = 1
      state.hasMore = true
      state.items = []
      state.lastUpdated = 0
      renderEmpty('正在加载资源...', '请稍候，资源列表正在刷新。')
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
    if (!state.hasMore && !reset) return

    state.loading = true
    elSentinel.hidden = false
    const spinner = elSentinel.querySelector('.spinner')
    if (spinner) spinner.style.display = 'block'
    setStats('正在同步缓存资源...')

    try {
      const response = await fetch(buildListUrl())
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()

      const incomingItems = Array.isArray(data.items) ? data.items : []
      state.items = reset ? incomingItems : state.items.concat(incomingItems)
      state.total = Number(data.total || 0)
      state.hasMore = Boolean(data.hasMore)
      state.page += 1

      state.lastUpdated = state.items.reduce((latest, item) => Math.max(latest, Number(item.mtime || 0)), 0)

      const partial = state.items.length < state.total
      renderItems(state.items)
      updateHint(partial)
      updateLoadMore()
      setStats(`共 ${state.total} 条资源，当前已加载 ${state.items.length} 条。`)
      updateSummary()
    } catch (error) {
      console.error(error)
      state.hasMore = false
      setStats('资源列表加载失败，请稍后重试。', true)
      renderEmpty('加载失败', '未能读取缓存资源列表，请检查服务状态后重试。')
      updateHint(false)
      updateLoadMore()
      showToast('资源列表加载失败', 'error')
    } finally {
      state.loading = false
      if (spinner) spinner.style.display = 'none'
      elSentinel.hidden = !state.hasMore
      updateLoadMore()
    }
  }

  const calcNewCount = data => {
    const results = Array.isArray(data?.results) ? data.results : []
    return results.filter(item => !item.skipped && !item.error).length
  }

  const stopSeedPolling = () => {
    clearTimeout(seedPollTimer)
    seedPollTimer = null
  }

  const finalizeSeedState = async data => {
    const newCount = Number(data?.newCount || 0)
    if (data?.status === 'success') {
      state.lastSeedMessage = newCount > 0 ? `新增 ${newCount} 条资源` : '无新增资源'
      showToast(
        newCount > 0
          ? `Seed 抓取完成，新增 ${newCount} 条资源。`
          : 'Seed 抓取完成，本次没有新增资源。',
        newCount > 0 ? 'success' : 'info'
      )
      await load(true)
    } else {
      state.lastSeedMessage = '抓取失败'
      showToast(data?.error || 'Seed 抓取失败，请稍后再试。', 'error')
    }
    updateSummary()
  }

  const pollSeedStatus = async () => {
    try {
      const response = await fetch('/api/seed-status')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()

      if (data.running || data.status === 'running') {
        state.lastSeedMessage = data.message || '正在抓取中'
        updateSummary()
        seedPollTimer = setTimeout(pollSeedStatus, 1200)
        return
      }

      stopSeedPolling()
      clearTimeout(seedSpinnerTimer)
      setSeedLoading(false)
      seedBusy = false
      await finalizeSeedState(data)
    } catch (error) {
      console.error(error)
      stopSeedPolling()
      clearTimeout(seedSpinnerTimer)
      setSeedLoading(false)
      seedBusy = false
      state.lastSeedMessage = '抓取失败'
      updateSummary()
      showToast('Seed 状态获取失败，请稍后重试。', 'error')
    }
  }

  const runSeed = async () => {
    if (seedBusy) return
    seedBusy = true
    stopSeedPolling()
    state.lastSeedMessage = '正在抓取中'
    updateSummary()
    seedSpinnerTimer = setTimeout(() => setSeedLoading(true), 250)

    try {
      const response = await fetch('/api/seed', { method: 'POST' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()

      if (data.running || data.status === 'running') {
        pollSeedStatus()
        return
      }

      clearTimeout(seedSpinnerTimer)
      setSeedLoading(false)
      seedBusy = false
      await finalizeSeedState(data)
    } catch (error) {
      console.error(error)
      clearTimeout(seedSpinnerTimer)
      setSeedLoading(false)
      seedBusy = false
      state.lastSeedMessage = '抓取失败'
      updateSummary()
      showToast('Seed 抓取失败，请稍后再试。', 'error')
    }
  }

  segBtns.forEach(button => {
    button.addEventListener('click', () => {
      segBtns.forEach(item => item.classList.remove('is-active'))
      button.classList.add('is-active')
      state.type = button.dataset.type || ''
      updateSummary()
      load(true)
    })
  })

  elSearch.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      state.q = elSearch.value.trim()
      updateSummary()
      load(true)
    }, 260)
  })

  elSortBy.addEventListener('change', () => load(true))
  elOrder.addEventListener('change', () => load(true))
  elTimeRange.addEventListener('change', () => load(true))
  elPageSize.addEventListener('change', () => {
    state.pageSize = Number(elPageSize.value || 30)
    load(true)
  })

  elRefresh.addEventListener('click', () => {
    showToast('正在刷新资源列表...', 'info')
    load(true)
  })

  if (elSeedTrigger) {
    elSeedTrigger.addEventListener('click', () => {
      if (seedBusy) return
      clearTimeout(seedDebounceTimer)
      seedDebounceTimer = setTimeout(runSeed, 220)
    })
  }

  const onScroll = () => {
    const show = window.scrollY > 360
    elBackTop.classList.toggle('show', show)
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  elBackTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })

  if (elLoadMore) {
    elLoadMore.addEventListener('click', () => {
      load(false)
    })
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closeSidebar()
  })

  state.pageSize = Number(elPageSize.value || 5)
  updateSummary()
  updateLoadMore()
  renderEmpty('正在准备资源...', '系统正在读取缓存索引，请稍候。')
  load(true)
})()
