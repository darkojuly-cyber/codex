# 部署与 sandbox 验收

## 1. 执行边界

本轮代码实现不授权生产发送。D-01–D-22 未批准事项保留 `PENDING_APPROVAL`；不要把示例奖励、真实服务链接、频道或角色臆造成已确认配置。首次使用只在独立测试 Guild 验证。官方素材未提供，Console 只显示明确的 placeholder。

无需创建 Git worktree；云任务已隔离，使用 `/workspace/codex` 当前 checkout。

## 2. 环境变量

`.env.example` 的空值会被忽略；本地默认如下。

| 变量 | 默认 / 作用 |
|---|---|
| `APP_MODE` | `mock`；真实服务用 `discord`，与 Vite/Vitest 的 `MODE` 分开 |
| `DATABASE_URL` | Mock 可空；真实模式必须为独立 PostgreSQL 连接，按托管商要求启用 TLS，不关闭证书校验 |
| `DATA_DIR` | `.data`；仅嵌入式本地数据库 |
| `HOST`, `PORT` | `127.0.0.1`, `3000`；Mock 禁止绑定非 loopback |
| `PUBLIC_ORIGIN` | 本地 `http://localhost:3000`；真实模式必须是后台 HTTPS Origin |
| `DISCORD_TOKEN` | Bot 凭证，仅平台秘密设置注入 |
| `DISCORD_GUILD_ID` | 明确的唯一测试 Guild Snowflake |
| `DISCORD_CLIENT_ID` | Developer Portal Application ID |
| `DISCORD_CLIENT_SECRET` | OAuth2 confidential client secret，仅后台登录需要 |
| `DISCORD_REDIRECT_URI` | 与 Portal 完全一致，如后台 HTTPS 域名的 `/api/auth/callback` |
| `STAFF_ROLE_IDS` | 逗号分隔真实 Staff IDs → `COMMUNITY_MANAGER` |
| `MODERATOR_ROLE_IDS` | Mods IDs → `MODERATOR` |
| `SUPPORT_ROLE_IDS` | Support IDs → `SUPPORT`；工单 Discord 覆盖授权角色 |
| `SUPER_ADMIN_USER_IDS` | 逗号分隔；仍需每次确认本人属于该 Guild，不授予 Discord 管理角色 |
| `DISCORD_WRITES_ENABLED` | `false`；显式 `true` 才允许注册命令、Gateway 启动和 Discord 资源写入 |
| `GUILD_MEMBERS_INTENT` | `false`；Portal 获批且开启后才设置 `true`，用于自动欢迎 |

不要在聊天发送 Token，不把 Token 作为命令行参数，不提交 `.env`。正式凭证在平台环境秘密管理器中注入。OAuth access token 仅在回调内存中短暂使用，不写库、不记录。员工登录只请求 `identify`，再用 Bot 查询当前 Guild membership 与角色；每个管理请求重新验证，撤销角色后立即失权。使用授权码 + client secret + 一次性 state / 浏览器绑定 cookie；本版未实现 PKCE，在上线前按 Discord 最新官方支持情况复核。

需允许的网络目的：npm 安装 `registry.npmjs.org`；Discord 运行 `discord.com`（REST / OAuth）、Discord Gateway 发现地址 `gateway.discord.gg`（WSS）。Gateway WSS 与密钥代理的兼容性取决于部署平台，必须在测试 Guild 实测。当前本地测试不证明此网络路径可用。

## 3. PostgreSQL

开发可执行 `POSTGRES_PASSWORD=<在本机安全设置> docker compose up -d postgres`。不要使用文档示例作生产密码；将实际数据库 URL 安全注入 `DATABASE_URL`。

```sh
npm ci
npm run db:migrate
npm run build
```

独立 migration 命令只在服务停止时运行；migration 幂等。API 启动会自动执行 migration，本地 PGlite 服务运行期间不要再执行 `npm run db:migrate`，也不要启动第二个 API。外部 PostgreSQL 首次准备可先单独迁移，再启动多个服务。首次 seed 在真实模式下全部 inactive，只有明确审定的新 seed 才可使用。PGlite 与 PostgreSQL 使用同一 SQL schema；PGlite 仅单进程本地开发。

## 4. Discord 只读核查

1. 在 Developer Portal 配置 Guild 安装的 `bot` 与 `applications.commands`。不要授予 Administrator。
2. 先保持 `DISCORD_WRITES_ENABLED=false`，执行 `npm run discord:audit`；命令只调用 GET，导出实际 ID / 类型 / 权限。不会创建频道或角色，也不会修改原生 Onboarding。
3. 人工核对现有频道、角色和 Bot 权限；不要按名称模糊匹配。数据库不负责维护 Discord 员工角色映射，员工授权 ID 由部署配置持有，不能由普通运营自助提权。
4. 最少需要 View Channel、Send Messages；附件 Prompt 需要 Attach Files；工单需要 Manage Channels、Read Message History 及已批准工单分类。按实际目标频道检查覆盖。GuildMembers 是 privileged intent，需 Portal 配置/可能的审批。
5. 本版不申请 MessageContent；无舆情覆盖能力，不读取/存储公开社区聊天或普通 DM。

## 5. 启动真实 sandbox

确认测试 Guild、操作范围和 D-02 工单分类批准后，显式开启 `DISCORD_WRITES_ENABLED=true`。**不要用生产 Guild 测试。**

```sh
npm run bot:register
# 三个独立进程 / 容器，共享外部 PostgreSQL
npm run api
npm run bot
npm run worker
```

`bot:register` 替换该 Application 在指定测试 Guild 的命令集合为 `/welcome`、`/idea`、`/ticket`，不注册全局命令。此命令是显式写操作，不能放入安装脚本。后台 TLS 由反向代理终止，API 只通过内部网络暴露；使用 `HOST=0.0.0.0` 仅限真实模式的受控容器，不公开 API 明文端口。

Console 登录后：Settings 绑定已核对的 ID → 保存草稿 → Lifecycle 检查完整草稿并发布。只有业务确认后才启用 welcome/tickets/messaging。配置只影响新交互；发送前 Worker 再核对 messaging 开关和频道白名单。旧 welcome 的自定义按钮实时查询当前配置，不静态嵌入过期产品 URL。

自动欢迎需要 Developer Portal 开启 **Server Members Intent**，并设置 `GUILD_MEMBERS_INTENT=true`。Console 设置欢迎频道并启用 welcome，保存草稿后发布才会生效。开启原生 Onboarding 的服务器在完成 Onboarding 且通过成员筛选后向欢迎频道发布按钮卡片；未开启 Onboarding 的服务器在新成员入群且通过成员筛选后发布。数据库按成员去重，不会因其他成员信息更新重复欢迎。即使成员在 Bot 启动前入群，启动后收到其完成 Onboarding/成员筛选的实时事件也会处理；不会在启动时扫描或补发历史成员，停机期间已完成的成员可用 `/welcome` 补看。欢迎发送结果未知时标为 `UNKNOWN`，不自动再发。

## 6. 容器

`Dockerfile` 为所有服务提供统一镜像。默认启动 API，命令覆盖可选 `npm run bot` / `npm run worker`。构建包含 TS runner，运行依赖目前未做最小镜像裁剪。外部 PostgreSQL、反向代理 TLS、秘密注入、备份和监控由部署平台提供。必须使用真实模式，镜像不会自动配置 Discord 或部署服务。

可用 `npm run image:build` 构建 `evomeme:local`（也可 `npm run image:build -- your-image:tag`）。脚本沿用现有代理变量、使用主机解析器为 BuildKit 补充代理主机映射，并将已经配置的 `NODE_EXTRA_CA_CERTS` 作为可选构建期 CA；不更改网络白名单、不使用公共 DNS、不提取代理凭证。Docker 客户端默认目录不可写时，可显式指定工作区内的 `DOCKER_CONFIG` 目录，再运行此命令；已有可用 Docker 配置则保留。

使用公司/平台 TLS 代理时，官方 Node 基础镜像可能没有该代理 CA。如果平台已提供 `NODE_EXTRA_CA_CERTS` 指向可信公共 CA 文件，可用：`docker build --build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY --secret id=build_ca,src="$NODE_EXTRA_CA_CERTS" -t evomeme .`。普通无代理环境不需要该 secret。此方式只追加安装阶段的可信 CA，不关闭 TLS/签名校验，不把代理凭证写入 Dockerfile。实际运行如仍通过该代理，需要平台提供运行时只读 CA bundle 并设置 `NODE_EXTRA_CA_CERTS`，路径必须指向存在的可信证书文件；不要设置 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或 `strict-ssl=false`。

## 7. 回滚 / 可靠性

- 先停用 messaging / welcome / tickets 并发布配置；必要时关闭写入开关并重启相关进程，再回滚镜像。
- 配置回滚会创建新草稿，需要明确发布，不会抹去历史。
- 队列每次抢占一条并锁行，重启保留；429 延迟至少遵循 retry-after，最多 5 次尝试；Discord REST 本身也管理 rate-limit bucket。
- 外部发送与数据库提交没有分布式事务。网络错误/崩溃后可能已发送但未记账，标记 `UNKNOWN`，**不承诺跨系统 exactly-once**，不盲目重试；查证 Discord 后人工处理。稳定 nonce 只覆盖 Discord 近期的重复请求窗口。
- 挂起的工单 `PROVISIONING` 需要人工核查（包括按工单号查找 Discord 私密频道）；不得自动重建，避免重复/遗留频道。失败清理出错会显示 `PRIVATE_CHANNEL_CLEANUP_REQUIRED`，需管理员处理。
- 工单关闭只更改业务状态；本版不自动归档/删除频道，也不吊销成员查看权限，不会将其改成公开。关闭前通过 Console 和工单频道与用户确认，按已审批保留策略手动归档。
- PostgreSQL 备份：由平台定时使用 `pg_dump` 或托管备份；恢复到独立库，运行专用验收后再切换。备份含工单内容，应加密且限制员工访问。
- Prompt 记录带 7 天到期字段，**本版没有自动清理 Worker**。正式收集用户数据前必须批准 retention、删除/导出流程、隐私告知和备份删除政策，不能将本地开发准备误认为生产上线许可。
