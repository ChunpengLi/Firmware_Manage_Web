# 固件与软件包管理系统

应用运行在 Cloudflare Workers，不依赖本地电脑常开。静态页面由 Workers Assets 提供，记录和选项保存在 D1，固件与软件压缩包存放在 R2。

## Cloudflare 资源

在 Cloudflare 同一账户创建：

- D1 数据库：`firmware-manage-db`
- R2 bucket：`firmware-manage-files`

把 D1 的 UUID 写入 `wrangler.jsonc` 的 `database_id`，再初始化数据库：

```sh
npm ci
npx wrangler d1 migrations apply firmware-manage-db --remote
```

在 Worker 的 Settings → Variables and Secrets 中添加以下加密 Secrets：

- `ADMIN_PASSWORD`：管理员登录密码
- `SESSION_SECRET`：至少 32 字节的随机签名密钥

AI 功能可选配置 `ANTHROPIC_AUTH_TOKEN` 和 `ANTHROPIC_BASE_URL` 两个 Secret。不要把密钥写进仓库或 `wrangler.jsonc`。

## 发布

将 GitHub 仓库连接到 Cloudflare Workers Builds，生产分支设为 `main`，构建命令为 `npm ci`，部署命令为 `npx wrangler deploy`。之后推送到 `main` 会自动发布。首次发布前需要完成 Cloudflare 资源、Secrets 和 D1 迁移。

本地运行：

```sh
npm ci
npm run dev
```

## 数据与访问

- 网页中的下载按钮要求管理员账户登录；`PUBLIC_DOWNLOADS=true` 时，文件 API 直链仍可匿名下载。当前登录使用 Worker 的 `ADMIN_PASSWORD`，尚未接入独立 HS 单点登录。
- 每个文件通过 8 MiB 分片上传到 R2，单文件上限 1 GiB。
- D1 与 R2 是独立资源；应分别启用备份或定期导出。
- `data/`、`uploads/` 和 `ai_workspace/` 等本地运行数据被 Git 忽略，不会随代码推送。
