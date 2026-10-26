# 交付与验收记录

版本：V0.2 积分增量 · 2026-10-23

## 仓库审计与实现范围

开发前仓库只有 `README.md`（标题 `codex`），没有 Bot、前端、数据库、AGENTS.md、依赖或已有用户改动。此轮在原 checkout 增量实现，未创建 worktree，未连接或改动生产 Discord。

上传规格涵盖多个里程碑；其中启动说明以 M0 为起点、要求分期交付。本轮交付 **M0 基础设施 + V0.1 的主要业务闭环**，不是完整 PRD 1.0。源规格原样保存，不能把文档中的推荐值视为运营批准。

| 目录 | 实现 |
|---|---|
| `apps/discord-bot` | Gateway 入口、guild-scoped slash commands、ephemeral 组件、原生工单 Modal、Onboarding flag 检测 |
| `apps/admin-console` | 可操作 React Console：Overview、Tickets、Messaging、Mimo & Ideas、Lifecycle、Settings、Audit |
| `apps/api` | Fastify API、Discord OAuth2、服务端角色校验、会话、CSRF、Origin、安全响应头、限流 |
| `apps/worker` | PostgreSQL 单次计划任务、锁行抢占、延迟重试、回执/未知结果 |
| `packages/core` | 业务规则、配置版本、审计、事件 outbox、Discord / Mock adapter |
| `packages/db` | PGlite 本地 / pg 外部库、migration、单进程本地文件锁 |
| `packages/ai-adapter` | 可替换 PromptProvider 接口和无付费调用的模板实现、失败 fallback |
| `tests` | 31 条核心/API/适配器测试 + 1 条磁盘关闭/恢复测试；2 条真实浏览器流程 |

依赖关系：Console / Gateway / Worker → Core → PostgreSQL / Discord adapter；可选 PromptProvider 只接收审定 seed，不接收私密工单。PostgreSQL 队列是 Redis 的等价替代，因此当前不要求 Redis 服务。

## 自动检查

在当前云环境已执行：Node 24.19、npm 11.9、Chromium；外部数据库测试使用官方 PostgreSQL 17 临时容器。

| 检查 | 结果 / 证据 |
|---|---|
| `npm ci --cache /tmp/evomeme-npm-cache` | 冻结 lockfile 重新安装成功 |
| `npm run db:migrate` | 默认本地 Mock 初始化成功；不会创建生产用户 |
| `npm run typecheck` / `npm run lint` / `npm run build` | 通过，生成可部署 Console 静态资源 |
| `npm test` | 32 项通过；31 项使用内存 PGlite，1 项实际磁盘关闭并重开，含活跃锁拒绝与死进程锁恢复 |
| `TEST_DATABASE_URL=… npm test` | 专用 PostgreSQL 17 上核心/API/适配器测试通过；磁盘测试仍单独验证 PGlite |
| `npm run test:e2e` | 2 项 Chromium 流程通过：完整运营链路 + Support 越权拒绝；390px 宽度无横向溢出，预览中的 HTML 注入按文字渲染 |
| `npm audit` | 当前锁定依赖 0 个已知漏洞；不是完整生产安全审计 |
| Docker | `npm run image:build` 构建通过；非 root（UID 1000）容器启动后 `/api/health` 与构建版 Console HTML 检查通过，Mock / 无真实写入 |
| 构建版 Console | 由 API 直接提供静态资源，Chromium 登录与 Dashboard 检查通过，page errors = 0 |
| 真实 Discord / OAuth / 工单权限 | **未执行**：当前没有 Bot Token、Guild、OAuth 凭证或已批准 ID；适配器/OAuth 测试使用 mock HTTP，不是线上成功证据 |

截图均来自真实运行的本地 Mock Console：

- [桌面概览](screenshots/overview-desktop.png)
- [消息确认与投递回执](screenshots/message-delivery.png)
- [手机宽度概览](screenshots/overview-mobile.png)

## 对照 PRD 14 项验收

“本地覆盖”不能替代真实测试 Guild 的验收；未实现项没有以“禁用等于通过”的方式记为成功。

| PRD 编号 | 当前状态 |
|---|---|
| 1 只读审计 | GET-only 工具、原始权限数据已实现；22 频道/9 角色实际核对未执行 |
| 2 欢迎一次 | 入群/原生 Onboarding 完成/成员筛选完成事件已接入；欢迎频道公开按钮卡片，数据库去重；支持启动后收到的完成事件，不扫描历史成员；真实 Gateway 自动发布待验收；`/welcome` 为私密补看入口 |
| 3 阶段切换 | 校验、动态 CTA、版本发布/回滚、本地测试及 Console E2E 覆盖；旧成员不因配置发布被补发欢迎 |
| 4 Mimo 稳定 | 英文 persona / 专业工单文案；官方素材缺失，只有文字 placeholder，未绘制替代图；SHA 核对待素材 |
| 5 工单私密 | 服务端跨账号 404、并发限额、失败清理、真实 adapter deny @everyone payload 测试；实际 Discord 有效权限待验收 |
| 6 Known Issues | 未实现；无公开私人工单入口 |
| 7 舆情可控 | 未实现；不请求 MessageContent，不采集社区聊天，不声称舆情覆盖 |
| 8 XP 幂等 | 账本、规则审核发布、同源事件去重、并发限额、等级及周/月/总榜已实现并本地验证；真实 Guild 待验收 |
| 9 Boost | 新观察到的 Boost 状态跟踪、REST 定期核查、首次及 30 天规则已实现；历史补发/批量历史扫描不做；默认发奖关闭 |
| 10 定时消息 | 单次持久任务、并发 Worker、取消、未来时间、重启、429、回执和无 mentions 已本地覆盖；重复日历任务未实现；真实发送待验收 |
| 11 DM 订阅 | 未实现；没有 DM 或批量成员消息发送入口 |
| 12 Idea | 完整可玩 Prompt、每日限额、种子降重复、Provider 失败 fallback 已测试；Discord 附件手动复制，不伪造剪贴板按钮 |
| 13 权限 | 服务端角色矩阵、Support 隔离、Mods 配置拒绝、OAuth 一次性 state / 角色撤销本地测试；真实 OAuth 待验收 |
| 14 安全 | CSRF、Origin、无权限访问、输入校验、跨 Guild 拒绝、XSS 文本转义、会话退出测试；完整安全评估/渗透测试未执行 |

## 未决事项和下一里程碑

- **业务**：按用户要求实现了 D-11 对应的后台中英切换；其他事项保留原审批状态。生产 welcome、tickets、messaging 默认 false，真实写入环境开关默认 false。
- **外部输入**：真实测试 Guild、已审定分类/频道/角色、OAuth 回调、品牌原始素材与 SHA 清单、官方 HTTPS 产品链接；秘密仅通过部署平台安全配置，不在聊天提交。
- **M1 差距**：help-desk 独立常驻工单面板、欢迎状态补查、工单附件/对话同步、状态通知与自动归档、模板/Embed/附件消息、完整沙盒人工验收；当前 `/ticket` 和 welcome 按钮可作为入口。
- **M2 后续**：周期榜快照与公告、历史 Boost 补发策略、荣誉角色自动发放、消息重复任务、通知偏好；积分规则、账本、Boost 核查和实时周期榜已实现，生产数值仍需运营审核发布。
- **M3**：公开频道结构化采样、分类/预警、AutoMod 审计、人工复核、脱敏 Known Issues、日报周报；不自动处罚。
- **M4**：多方审批、scheduled lifecycle、可用性监控、错误看板、数据保留/清理/删除导出、备份恢复实演、sandbox canary 与运营培训。
- **可靠性边界**：Discord 与数据库无跨系统原子提交；未知发送结果不盲重试，遗留 PROVISIONING 工单人工核查。工单关闭不修改可见权限、不自动公开。生产前必须按 [部署手册](DEPLOYMENT.md) 演练。

## 云环境配置

已保存 `install_script` 和 `start_skill`：安装/构建（迁移由服务启动执行），以及基于现有 checkout 的本地 Mock 启动、检查和生产边界。保存只产生环境草稿，不执行/发布配置。当前实例已运行安装和测试，**没有声称新任务恢复、配置发布或生产部署已通过**。请在环境设置审核保存后发布，才能形成新的环境版本。

## 容器运行记录

本环境的 BuildKit 不能直接解析主机上的代理名称，官方 Node 镜像也没有平台的额外 CA。通过既有可信主机解析器补充代理 host 映射、挂载平台已配置 CA 后完成构建，未关闭 TLS / 校验。另修复了源文件权限较严时非 root 用户不能读取文件的问题：Docker COPY 明确归属 node 用户。

最终本地验证镜像 `evomeme:v0.1-validation`，ID `49bfa7c878e11d112343e95652b1d23794b96aabfc11ef463e83a0fd5da28dee`；没有推送到镜像仓库、没有部署线上服务。验证容器使用 Mock、无外部端口映射，测试后清理。宿主机保留本地 Mock API / 构建版 Console 进程，进程不保证在新任务继续运行。

## 后台中英切换增量（2026-10-23）

- 登录页和后台页头提供简体中文 / English 切换，默认匹配浏览器并保存偏好；同步页面标题、`lang` 和日期显示语言。
- 覆盖导航、角色与业务状态、表单、操作按钮、确认提示、成功提示和常见错误。保留消息正文、欢迎模板、Prompt、种子与原始 JSON，不改动 Discord 用户端语言或 API 枚举。
- 语言切换不触发配置重载，不丢失当前表单输入；无 localStorage 权限时可继续切换，只是不持久保存偏好。
- 验证：37 项单元/集成测试、4 项 Chromium 端到端流程通过；另通过类型检查、lint 和生产构建。新增浏览器流程覆盖刷新保持、双向切换、中文错误提示、未保存内容保留、英文枚举提交、390px 布局及存储不可用降级。
- 本次没有重新构建或发布 Docker 镜像；上述镜像 ID 仍对应首次 V0.1 验证。使用本次源码需要重新构建镜像/前端，已解压的旧 ZIP 不会自动更新。

## V0.2 积分增量（2026-10-23）

用户在当前会话明确要求先实现积分。新增独立规则审批、账本、规则版本快照、限额/去重、人工贡献和加扣分、等级/周期榜、查询指令、欢迎卡规则入口及可选 Gateway 计分/Boost 核查。初始计分全部关闭，不把原 PRD 的拟定数值视为实际运营批准。使用与边界见 [XP.md](XP.md)。此前各项测试数字与 Docker 镜像记录均为当时验证记录，不代表本次已重建镜像或已在真实 Guild 发奖。

积分增量验证：lint/build 通过；PGlite/PostgreSQL 各 62 项测试通过；Playwright 7 个流程通过；独立 PostgreSQL 的实际 HTTP 规则发布、首次发奖与重复提交去重验证通过。未连接用户的 Neon 凭证、未注册真实 Guild 命令、未自动发布线上积分规则。

## Evo Points 卡片与确认分值（2026-10-26）

环境恢复后完成成员卡改版：保留头像、标题和紫色主题，使用用户最终确认的 Evo Points 文案与软性页脚。按钮连接本人积分、本周榜和本月榜；旧欢迎卡入口兼容。预设数值为首次发言 10、聊天 2/日上限20、创作 5/日上限20、问题建议 3/日上限18、精选10、首次Boost20、连续30天30。新增后台生成草稿入口，旧规则、旧账目不自动覆盖，总开关关闭。详见 [EVO_POINTS_CARD.md](EVO_POINTS_CARD.md)。真实 Guild 卡片仍需用户本机更新后验收。

Evo Points 卡片本轮验证：lint/build、69 项本地测试和 8 项浏览器流程通过；未重新运行真实 PostgreSQL 或用户 Neon 的验证，未更改线上规则。

## Windows 一键启动（2026-10-26）

新增 Start.cmd、Stop.cmd、Status.cmd：单控制窗口启动 API/Caddy/Bot/Worker，源码变化时自动构建，服务就绪后打开本地后台。会话防重复、本地认证控制、凭证日志过滤、重启及 PID 复用状态恢复均有测试；停止只作用于本次自己启动的子进程。通过 lint/build、78 项本地测试和 8 项浏览器流程。Windows CMD/CIM/证书联动需要用户本机首验，云端未声称实际运行成功。详见 [WINDOWS_LAUNCHER.md](WINDOWS_LAUNCHER.md)。
