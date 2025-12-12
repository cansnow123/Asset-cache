# Asset Cache Server（CSS/JS 永久缓存服务）

一个用于将外部 CSS/JS 资源永久缓存到本地并通过自有域名提供静态访问的 Node 服务。支持上传 TXT 批量抓取、按原 URL 目录层级保存、去重跳过、返回可直接引用的公共路径与完整 URL，适合与 CDN 防盗链配合使用。

## 特性

- 保留原始目录层级：按源 URL 路径保存到 `cache/css` 或 `cache/js` 下
- 去重缓存：同一路径已存在则跳过抓取并返回 `skipped: true`
- 统一静态访问：通过 `/css/...` 与 `/js/...` 直接访问，设置长缓存头
- 批量抓取：支持上传 TXT（每行一个 URL）或一次提交多条 URL
- 结果即用：API 返回 `saved`（公共路径）与 `accessUrl`（完整 URL）
- 环境配置：支持 `.env` 设置 `PORT`，适配反向代理与不同端口
- 路径安全：剔除 `..` 等越权片段，写入校验不越出缓存根

## 原理与代码位置

- 目录与类型解析：`server.js:42`（`resolveTargetPath`）
- 抓取与去重：`server.js:133`（`fetchAndStore`）
- TXT 解析与批量：`server.js:164`、`server.js:176`
- 静态目录映射：`server.js:192`–`server.js:193`
- 公共路径与完整 URL：`server.js:107`（`getPublicPath`）、`server.js:121`（`buildAccessUrl`）
- 前端首页注册：`server.js:42`（`registerPublicHomepage`）

## 快速开始

- 安装依赖：`npm install`
- 设置端口（任选其一）：
  - 在 `.env` 中写入：`PORT=11488`
  - Windows 启动前：`$env:PORT=11488; npm start`
  - Linux/systemd/pm2：在进程配置里设置环境变量 `PORT`
- 启动服务：`npm start`
- 健康检查：`GET /health` → `{"ok":true}`

## 前端首页

- 访问路径：`/`
- 内容包含：项目简介、健康检查入口、触发 Seed 抓取入口、免责声明与推荐公共 CDN 列表、已缓存资源的可视化列表（仅展示可直接复制的完整 URL）
- 目的：为内部用户提供更直观的访问入口与使用指引
 
### 缓存区布局优化说明

- 字体与文本：统一行高与字间距，`url` 文本支持多行折行显示并保留省略控制，确保在窄屏下仍具可读性
- 按钮与控件：增大最小高度与内边距，提升可点击区域；工具栏分为上下两行以避免拥挤
- 布局优化：工具栏采用两行分组（类型/时间/刷新、搜索/排序/方向/页容量），列表卡片增加间距与对比度
- 视觉一致性：沿用暗色科技风、玻璃拟态渐变与细边框，悬停有轻微抬升与阴影反馈
- 响应式适配：≥1100px 两列卡片、<760px 单列；工具栏在小屏纵向排列，输入与选择控件宽度自适应
 - 高级功能：分页加载（20–50/页）、按名称/类型/更新时间过滤、按名称/大小/时间排序、懒加载与轻量虚拟滚动、统一暗色科技风视觉与动画

## 使用声明（免责声明）

- 本网站收录的开源库均仅支持内部使用，不对外提供公共 CDN 服务
- 如需稳定的外部公共库服务，请使用以下成熟 CDN：
  - BootCDN 加速服务：`https://www.bootcdn.cn/`
  - CDNJS 前端公共库：`https://cdnjs.com/`
  - jsDelivr：`https://www.jsdelivr.com/`
  - 七牛免费 CDN 前端公开库：`https://www.staticfile.org/`
  - 又拍云常用 JavaScript 库 CDN 服务：`http://jscdn.upai.com/`
  - Google Hosted Libraries：`https://developers.google.com/speed/libraries`
  - Microsoft Ajax CDN：`https://ajax.aspnetcdn.com/`

## 接口说明

- `GET /api/seed`
  - 从项目内置 `seed.txt` 读取并批量抓取，无需重启
  - 管理抓取仅通过修改服务器上的 `seed.txt` 实现，服务端不接受外部提交 URL

- `GET /api/list-cache`
  - 列出当前已缓存的 CSS/JS 文件，按最近修改时间倒序
  - 查询参数：
    - `type`: `css` | `js`（可选）
    - `q`: 关键字（可选，匹配路径片段）
    - `limit`: 最大返回条数（默认 200，最多 2000）
  - 返回示例：
    ```json
    {
      "count": 200,
      "total": 1234,
      "hasMore": true,
      "items": [
        { "type": "css", "path": "/css/npm/.../file.css", "url": "http://host/css/npm/.../file.css", "size": 12345, "mtime": 1730000000000 }
      ]
    }
    ```

### 接口更新（list-cache 扩展）

- `GET /api/list-cache`
  - 支持分页、排序与更丰富的过滤参数：
    - `type`: `css` | `js`（可选）
    - `q`: 关键字（匹配路径片段与URL，模糊搜索）
    - `name`: 库名称（匹配解析出的名称，模糊搜索）
    - `updatedFrom` / `updatedTo`: 毫秒时间戳范围过滤（可选）
    - `sortBy`: `mtime` | `name` | `size`（默认 `mtime`）
    - `order`: `asc` | `desc`（默认 `desc`）
    - `page`: 页码（默认 1）
    - `pageSize`: 每页条数（默认 30，范围 20–50）
  - 返回字段增加：`page`、`pageSize`、`name`、`version`、`ext`、`category`
  - 示例：
    ```json
    {
      "count": 30,
      "total": 1234,
      "page": 1,
      "pageSize": 30,
      "hasMore": true,
      "items": [
        {
          "type": "css",
          "path": "/css/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css",
          "url": "http://host/css/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css",
          "size": 12345,
          "mtime": 1730000000000,
          "name": "bootstrap",
          "version": "5.3.0",
          "ext": ".css",
          "category": "bootstrap"
        }
      ]
    }
    ```

## 静态访问

- CSS：`/css/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css`
- JS：`/js/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js`

## 保存规则与目录结构

- 路径规则：按原 URL 路径层级保存到 `cache/css` 或 `cache/js`
  - 原地址：`https://cdn.jsdmirror.com/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css`
  - 本地保存：`cache/css/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css`
  - 对外访问：`/css/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css`
- 类型判定：优先扩展名（`.css`/`.js`），其次 `Content-Type`
- 安全加固：移除 `..` 等越权片段，写入前校验不越界（`server.js:65` 起）

### 规则补充（无扩展名与根路径资源）

- 无扩展名的资源将根据类型自动补全扩展名：`text/css` → `.css`、`application/text-javascript`/`text/javascript` → `.js`
- 根路径资源（如 `https://cdn.tailwindcss.com`）为避免跨域冲突，将以主机名作为首层目录：
  - 本地保存：`cache/js/cdn.tailwindcss.com/index.js`
  - 对外访问：`/js/cdn.tailwindcss.com/index.js`

### 字体与依赖资源处理（CSS 自动抓取）

- 当抓取 `CSS` 文件时，会自动解析其中的 `url(...)` 引用，并尝试下载相对路径的依赖（如字体、图片等），统一保存到 `cache/css/...` 对应目录下，保持与源路径相同的层级结构。
- 这样，形如 `@font-face { src: url(fonts/element-icons.woff) }` 的引用将会在本地落盘为：`/css/.../fonts/element-icons.woff`，无需跨域请求第三方源。
- 失败的依赖抓取会被静默跳过，不影响主 `CSS` 的可用性。
- 针对使用 `../webfonts/...` 的场景（如 Font Awesome），已修正对上级目录的处理，确保依赖文件最终位于与 `css/` 同级的 `webfonts/` 目录；旧版本误存于 `css/webfonts/` 的文件会在后续抓取时自动迁移到正确位置。

## 去重策略

- 目标路径存在则跳过抓取，响应中返回 `skipped: true`
- 强制刷新：删除对应缓存文件后再次触发抓取

## 安全与白名单建议

- 推荐在 CDN/WAF 层配置防盗链白名单（如 `*.aaa.com`、`www.bbb.com`）
- CORS 建议在 CDN/WAF/网关统一配置按域名的跨域放行策略，服务端默认不设置跨域响应头。
- 管理接口仅保留 `GET /api/seed`，不提供外部 POST；如需更强控制可扩展签名 URL 校验（服务端或边缘验证令牌）

## 部署建议

- Windows（开发/测试）：`npm install && $env:PORT=11488; npm start`
- Debian 12 / Node 22.19.0（生产）：
  - 创建 `.env` 设置端口：`PORT=<你的端口>`
  - `npm install && npm start`
  - 建议使用 systemd/pm2 守护进程，并在 Nginx 反向代理到 `127.0.0.1:<PORT>`

## 常见问题（FAQ）

- 修改 `seed.txt` 是否需要重启？不需要，`GET /api/seed` 会重新读取。
- 同名文件内容更新如何刷新？删除旧缓存文件后再触发，或用带版本号的 URL。
- 端口为何不是 3000？端口读取自环境变量 `PORT`，可通过 `.env` 或进程管理器设置。

## 变更记录（摘要）

- 增强目录层级映射与路径安全加固（越权剔除、根校验）
- 内置 `seed.txt` 与 `GET /api/seed`（无需重启）
- 去重逻辑（已存在则跳过，返回 `skipped: true`）
- `.env` 支持（`PORT`），适配多端口部署
- 接口响应统一返回公共路径 `saved` 与完整 URL `accessUrl`
- 依赖升级：`express@^5.1.0`、`multer@^2.0.2`、`axios@^1.13.2`、`morgan@^1.10.1`
- 移除外部提交接口：`POST /api/upload-txt` 与 `POST /api/cache`，仅支持通过 `seed.txt` 批量抓取
- 新增前端首页与公共静态目录（`public/`），主页包含免责声明及推荐公共 CDN 列表
- 新增 `GET /api/list-cache` 接口，支持过滤、限制与前端展示一键复制
- 升级首页缓存区域视觉与交互：统一暗色科技风、移除相对路径展示、仅保留完整 URL 复制与打开、优化响应式布局与过渡动画
- 增强缓存管理：分页加载（20–50/页）、按名称/类型/更新时间过滤、按名称/大小/时间排序、轻量虚拟滚动与懒加载、元数据解析（库名/版本/扩展名/类别）
- 修复分段筛选：切换 `CSS/JS/全部` 时重置分页并重新加载
- 静态缓存优化：`/` 与 HTML 响应禁用缓存；为首页 CSS/JS 增加版本参数以避免浏览器缓存旧样式与脚本
- 页面视觉细节：为 `header` 与 `main` 增加间距（≥30px），背景设置 `background-attachment: fixed` 并覆盖视窗（居中、等比、无重复）
- 修复：CSS 依赖路径对 `..` 上级目录的正确解析与落盘（兼容 Font Awesome 的 `../webfonts`）；增强 CDN 回退匹配支持 `@scope` 包名（jsDelivr / unpkg）
