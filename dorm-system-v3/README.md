# 宿舍检查系统 v3

Express 5 + Node.js 24 + SQLite。前端只有 `public/index.html`、`public/style.css`、`public/app.js` 三个文件；宿舍初始名单位于 `seed/dorms.json`，包含 531 条数据。无云端依赖。

## 本地启动

安装 Node.js 24，在本项目目录执行：

```sh
npm ci
npm run admin -- admin admin 管理员
npm start
```

创建管理员时交互输入密码（至少 12 位）。浏览器打开 http://127.0.0.1:3000 。不要通过 Live Server 的 5500 端口打开 HTML，否则接口请求会发到错误的服务。

本地不要设置 `NODE_ENV=production`；生产模式 Cookie 带 Secure，必须通过 HTTPS 使用。

## 后端结构

| 目录 / 文件         | 职责                                    |
| ------------------- | --------------------------------------- |
| `src/server.js`     | 监听和优雅退出                          |
| `src/app.js`        | Express 组装、中间件与路由挂载          |
| `src/config.js`     | 端口、本地监听、生产模式                |
| `src/routes/`       | HTTP 参数和响应：记录、账号、学期、会话 |
| `src/services/`     | 业务规则、权限、事务、导出              |
| `src/repositories/` | 共享 SQL 筛选、分页和照片写入           |
| `src/domain.js`     | 评分、日期、图片、记录校验              |
| `src/auth.js`       | 密码散列、登录限流、数据库会话          |
| `src/store.js`      | SQLite 建表、迁移、种子数据、事务       |
| `src/cli.js`        | 创建账号、备份、导入旧数据              |

每个接口用 Express Router 声明；异步异常交给统一错误中间件。写入事务保留在业务服务中，避免记录和照片部分保存。更新 / 删除记录使用 `version` 检测并发冲突。

## Cookie 会话

登录成功只在 `Set-Cookie` 返回随机会话凭证；响应 JSON 只包含用户信息。前端不读取 token，不保存到 localStorage，也不发送自定义认证请求头。数据库保存会话凭证的 SHA-256 摘要、用户 ID 和 8 小时有效期；服务端维护到期、退出、禁用和密码修改撤销。

Cookie 使用 HttpOnly、SameSite=Strict、Path=/，生产模式自动启用 Secure。跨站写入由 SameSite、请求来源及 Fetch Metadata 检查与 JSON 请求类型限制共同拦截；这些全部在后端完成，不需要前端防伪 token。没有 CORS 中间件、域名白名单或域名环境变量。

## Linux 服务器部署：现有 Nginx + Docker

```sh
docker compose up -d --build
docker compose exec app node src/cli.js user admin admin 管理员
```

Compose 使用 Linux 的 host 网络模式，让容器内 Node 与宿主 Nginx 共享 loopback。Node 固定监听 `127.0.0.1:3000`，不监听公网地址，不需要 `ports` 映射。此 Compose 面向 Linux 服务器；Windows 本地开发使用上面的 npm 命令。

把 `deploy/nginx.conf` 合并到你现有的 Nginx 配置，替换其中的域名和证书路径，检查并重载：

```sh
sudo nginx -t
sudo systemctl reload nginx
```

域名和 TLS 只在 Nginx 配置。应用仅信任 loopback 代理；Nginx 必须覆盖 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto`、`X-Forwarded-For`，示例已包含。示例假定 Nginx 为唯一直接入口；如果你已有多层代理，应按实际链路调整可信代理与真实 IP 配置。

也可不使用 Docker：`npm ci --omit=dev --ignore-scripts` 后用 systemd 启动 `node src/server.js`，设置 `NODE_ENV=production` 和 `DATA_DIR` 即可。应用支持的环境变量只有 `PORT`（默认 3000）、`NODE_ENV`、`DATA_DIR`。若改变端口，同步修改 Nginx upstream 和 Docker 健康检查。

## 数据及升级

运行时数据全部在 `storage/dorm.sqlite`，包含账号、记录、照片、会话、日志；Docker 使用持久化卷 `dorm-inspection-v3_dorm-data`。不要把 `seed/dorms.json` 当作运行时数据库。

备份：

```sh
npm run backup -- backups/dorm.sqlite
# Docker：先在卷中生成一致性快照，再复制到宿主
docker compose exec app node src/cli.js backup /app/storage/snapshot.sqlite
docker compose cp app:/app/storage/snapshot.sqlite ./dorm-backup.sqlite
```

备份不会覆盖已有文件，应使用新文件名。恢复前先停服务，再用快照替换目标数据目录中的数据库，并移走目标目录旧的 `dorm.sqlite-wal`、`dorm.sqlite-shm` 文件；确认容器用户 UID 1000 可读写后启动。不要在运行中直接复制 SQLite 主文件。

从 v2 升级：先备份，停止旧服务，再让 v3 使用旧数据卷（Compose 顶层 `volumes.dorm-data` 下设置 `external: true` 和真实旧卷的 `name`，通过 `docker volume ls` 确认）。首次打开旧数据库自动移除旧会话字段并使旧登录失效，账号、检查记录、照片和名单保留。不要同时启动 v2 和 v3 写同一个数据库。保留升级前备份用于回滚。

旧 JSON 检查记录导入仍支持：`node src/cli.js import-json 文件路径 学期ID`。导入先完整校验、再单次事务写入，失败不部分导入，同文件不能重复导入。

## 开发检查与测试

```sh
npm ci
npx playwright install chromium
npm run test:unit     # 领域规则、权限、密码、配置、事务、迁移
npm run test:api      # 真实 HTTP + SQLite 接口回归
npm run test:e2e      # Chromium 实际操作，自动启动独立测试服务
npm run lint
npm run format:check
npm run format       # 修复格式
npm run check        # 格式 + ESLint + UT + API
npm run check:all    # 上述全部 + E2E
```

E2E 使用 3107 端口和独立临时数据库，不复用运行中的业务服务、不使用真实账号。覆盖登录退出、Cookie 不可被 JS 读取、历史与未查分页、详情、图片上传、评分新增 / 编辑 / 删除以及手机布局。失败保留截图和 trace 到 `test-results/`。

## pre-commit 与 CI

采用 Git 原生 hook，脚本在 `.githooks/pre-commit`，没有额外 hook 框架依赖。`npm ci` 的 prepare 自动安装（仅对本项目自己的 Git 仓库生效，避免修改父仓库）。ZIP 解压目录尚未初始化 Git 时执行：

```sh
git init
npm run prepare
```

提交前运行 `npm run check`，格式、ESLint、UT、API 任何一项失败都阻止提交。请将通过检查的修改完整暂存后提交；hook 检查工作目录。E2E 由 CI 的 `npm run check:all` 执行，也可在本地手动运行。`.github/workflows/ci.yml` 已提供 GitHub Actions 配置。

## 实现参考

- [Express 可信代理配置](https://expressjs.com/en/guide/behind-proxies/)
- [Playwright 独立测试 Web Server](https://playwright.dev/docs/test-webserver)
