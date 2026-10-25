# 验证记录

本次验证环境：Windows，Node.js 24.22.1，npm 11.19.1。

| 检查                   | 结果                                                          |
| ---------------------- | ------------------------------------------------------------- |
| Prettier               | 通过                                                          |
| ESLint（零 warning）   | 通过                                                          |
| 单元测试               | 9 项通过                                                      |
| HTTP / SQLite 接口测试 | 13 项通过（含 1 个父测试）                                    |
| Chromium E2E           | 5 项通过                                                      |
| pre-commit 检查脚本    | 直接运行通过；注入未定义变量时以退出码 1 拦截，移除后恢复通过 |
| Git hook 安装          | 已验证 core.hooksPath 指向 .githooks                          |

接口测试覆盖权限、分页、CSV、照片、并发版本、账号撤销、学期隔离、重启、备份、旧 JSON 导入，以及 HTTPS 代理请求头、Secure Cookie、会话摘要存储、到期、跨站和非法请求拦截。UT 额外验证 v2 数据库会话字段迁移。

E2E 使用真实 Express 服务、SQLite 和浏览器，没有 mock 业务接口。覆盖登录错误、刷新维持登录、退出、HttpOnly Cookie、历史分页、未查分页、详情、上传照片后新增 / 编辑 / 删除、390px 手机视口。

环境限制：这里无法完整执行 `git hook run pre-commit`，因为沙箱禁止 Git 自带 MSYS env/sh 创建 Windows 命名对象；已直接用 Node 运行同一 hook 脚本验证成功和失败路径。应在正常开发终端再执行一次 `git hook run pre-commit` 确认 Git 调用链。

本机没有 Docker 和 Nginx，因此没有声称镜像构建或服务器反代已经实机通过。部署后应执行 `docker compose ps`、`nginx -t`，通过 HTTPS 验证登录与图片上传。
