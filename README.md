# Asset Cache Server（CSS/JS 永久缓存服务）

一个用于将外部 CSS/JS 资源永久缓存到本地并通过自有域名提供静态访问的 Node 服务。支持上传 TXT 批量抓取、按原 URL 目录层级保存、去重跳过、返回可直接引用的公共路径与完整 URL，适配 Windows / Debian 部署，适合与 CDN 防盗链配合使用。

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

## 快速开始

- 安装依赖：`npm install`
- 设置端口（任选其一）：
  - 在 `.env` 中写入：`PORT=11488`
  - Windows 启动前：`$env:PORT=11488; npm start`
  - Linux/systemd/pm2：在进程配置里设置环境变量 `PORT`
- 启动服务：`npm start`
- 健康检查：`GET /health` → `{"ok":true}`

## 接口说明

- `POST /api/upload-txt`
  - 上传 TXT（字段名 `file`），每行一个 URL；支持 `#` 注释与空行
  - 响应项示例：
    - `{
        "url": "https://cdn.jsdmirror.com/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css",
        "saved": "/css/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css",
        "accessUrl": "https://<你的域名>/css/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css",
        "filename": "bootstrap.min.css",
        "type": "css",
        "size": 232914,
        "skipped": false
      }`

- `POST /api/cache`
  - 提交单条 `url` 或数组 `urls`
  - 单条示例：`{"url":"https://.../bootstrap.min.css"}`
  - 多条示例：`{"urls":["https://.../bootstrap.min.css","https://.../bootstrap.bundle.min.js"]}`

- `GET /api/seed`
  - 从项目内置 `seed.txt` 读取并批量抓取，无需重启

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

## 去重策略

- 目标路径存在则跳过抓取，响应中返回 `skipped: true`
- 强制刷新：删除对应缓存文件后再次触发抓取

## 安全与白名单建议

- 推荐在 CDN/WAF 层配置防盗链白名单（如 `*.aaa.com`、`www.bbb.com`）
- 如需更强控制可扩展签名 URL 校验（服务端或边缘验证令牌）

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