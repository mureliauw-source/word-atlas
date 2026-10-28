# 部署与升级

账号版由静态前端、Node.js 22 API 和 SQLite 组成。
网页与 API 使用同一访问来源，Nginx 将 /api/ 转发到 API。
普通 HTTP 局域网地址和 HTTPS 公网域名均已用于现有 NAS 部署。
下面的 Compose 文件是可复用示例；现有 NAS 使用保留媒体目录的分步更新方式。

## 本地开发

需要 Node.js 22.13+，建议使用最新 Node.js 22 补丁版本。
在项目根目录安装依赖，然后开两个终端：

```bash
npm ci
npm run api
```

```bash
npm run dev
```

网页默认监听 http://127.0.0.1:5188，API 监听 http://127.0.0.1:3001。
开发代理已在 vite.config.ts 配置。
账号数据库默认写入 .data/word-atlas.sqlite。

## Docker Compose

先完整下载仓库中的图片、语音和词库索引，再构建应用：

```bash
npm ci
npm run build
npm run build:server
cp deploy/.env.example deploy/.env
```

Windows PowerShell 可用 Copy-Item deploy/.env.example deploy/.env 复制配置。
编辑 deploy/.env 后，在仓库根目录启动：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

默认访问地址为 http://localhost:18088。
通过 NAS IP 访问时，必须将该完整来源加入 ALLOWED_ORIGINS。
只有前端端口发布到宿主机；API 通过 Compose 内部网络提供服务。

| 文件或目录              | 用途                                       |
| ----------------------- | ------------------------------------------ |
| dist/                   | 前端页面、代码及媒体资源，只读挂载到 Nginx |
| dist-server/server.mjs  | 打包后的 API，只依赖 Node.js 内置模块      |
| public/atlas/index.json | API 校验词条编号所用的索引                 |
| deploy/data/            | 持久化账号、会话和学习数据                 |
| deploy/nginx.conf       | 静态页面及同域 API 反向代理                |
| deploy/.env             | 本机访问来源等配置，不提交到 Git           |

构建和测试命令已经执行验证。Compose 示例未在本机 Docker 中实际启动，
部署时应再检查容器健康状态、登录和保存结果。

## API 环境变量

| 变量              | 默认或示例                                  | 说明                                 |
| ----------------- | ------------------------------------------- | ------------------------------------ |
| API_HOST          | 127.0.0.1                                   | Docker 内设为 0.0.0.0                |
| API_PORT          | 3001                                        | API 监听端口                         |
| DB_PATH           | .data/word-atlas.sqlite                     | 持久化数据库路径                     |
| ATLAS_INDEX_PATH  | public/atlas/index.json                     | 词库索引路径                         |
| ALLOWED_ORIGINS   | http://127.0.0.1:5188,http://localhost:5188 | 逗号分隔的完整浏览器来源             |
| REWRITTEN_ORIGINS | 留空                                        | 仅用于确实改写 Origin 的受信穿透服务 |
| COOKIE_SECURE     | false                                       | 全部通过 HTTPS 访问时可设为 true     |

环境变量由启动进程提供。API 不会自行加载 .env 文件。
Compose 示例通过 environment 显式传入配置。
设置了 COOKIE_SECURE=true 后，普通 HTTP 页面无法使用该安全会话 Cookie。

## 公网域名与穿透

允许来源应包含协议、主机和实际端口，不带路径或末尾斜线。
例如，浏览器使用 https://words.example.com 时，将它加入 ALLOWED_ORIGINS。
保持同域 /api/ 转发，不要在浏览器里直接使用内网 API 地址。

现有穿透服务曾将 Origin 改写为内网地址。
仅在确认存在这种行为后，将确切改写值加入 REWRITTEN_ORIGINS。
服务器还要求该别名请求携带 Sec-Fetch-Site: same-origin。
不要使用通配来源，也不要为了排障移除来源校验。

健康检查地址为 /api/health，正常响应是 {"ok":true}。
页面可能从离线缓存中显示，页面可打开不代表 API 当前可达。
现有公网穿透链路曾出现间歇性超时，仍需按实际网络状态判断。

## 保存与持久化

答题、进入下一题、收藏和学习设置只更新浏览器草稿。
用户点击“保存到账号”时，客户端提交完整快照。
服务器检查账号、词库、版本号和操作编号，并在一个事务中保存。
失败重试复用原编号，另一设备已有新版本时拒绝覆盖。

导入原版版本 2 备份会更新本机草稿，之后仍需手动保存。
设备外观和播放偏好不在账号共享字段内。
清理浏览器站点数据前，应先保存草稿或导出备份。

SQLite 使用 WAL 模式，运行时可能同时存在 -wal 和 -shm 文件。
不要在服务运行中只复制主 .sqlite 文件作为完整数据备份。
需要备份账号数据时，应使用一致性备份，或停止 API 后备份整个数据目录。

## 更新与回退

升级前备份当前入口页、对应 JS/CSS 和 API 程序。
代码备份可以排除词库、图片和语音；账号数据目录应独立持久化。

1. 构建并检查新前端和 API。不要清空现有数据库或媒体目录。
2. 先更新 API，再切换前端入口。整批保存前端需要支持 save 操作的 API。
3. 检查 /api/health、页面资源、登录和手动保存。
4. 提醒用户重新加载旧页面，避免多端继续使用旧代码。

使用本示例的文件挂载时，重建后重新创建容器，确保挂载到最新文件：

```bash
npm run build
npm run build:server
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --force-recreate api web
```

回退时恢复旧前端入口、对应资源和 API 程序，再重建或重启相应服务。
保留数据库目录。此次新增账号功能不需要修改原词库媒体文件。

## 静态托管与子路径

只发布 dist/ 可以使用游客学习和本机备份。
Cloudflare Pages、GitHub Pages 等静态托管不会运行本项目的 Node.js API。
账号功能需要另行部署 API，并配置同域 /api/ 代理。

ATLAS_BASE=/words/ 可调整前端资源基础路径。
当前 API 地址固定为站点根路径 /api/，Nginx 示例也按根路径编写。
部署到子路径时，需要自行调整静态路径配置并验证 API 路由。
