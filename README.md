# EvoMeme · Mimo Discord Bot + Community Console

根据 `EvoMeme_DiscordBot_Codex_Spec_v1.0.zip` 实现的 **V0.2 可运行增量（含积分模块）**。包含真实 Discord Gateway / REST 适配器、Web Console、API、持久化消息 Worker 和 PostgreSQL migrations。原始规格保存在 [docs/spec](docs/spec/README_START_HERE.md)。

**当前可本地开发和测试，尚未部署或通过真实 Discord sandbox 验收；不等于完整 PRD 已交付。** 不需要 Token 即可运行 Mock。Mock UI 与 API 都明确标记，不生成伪造运营统计。

下载源码包后第一次使用，请先读 [START_HERE.md](START_HERE.md)，其中包含在自己电脑启动和五分钟操作路径。

## 快速运行

要求 Node.js 22.16+（验证版本 24.19）和 npm；采用 npm workspaces，提交了 `package-lock.json`。

```sh
cd /workspace/codex
npm ci --cache /tmp/evomeme-npm-cache
npm run dev
```

控制台默认端口 `5173`，API 为 `3000`；仅监听 loopback。CLI 会输出监听信息。无需创建 `.env`，默认 `APP_MODE=mock`。在登录页选择本地模拟角色；Mock 登录只能用于本机开发，不能公开暴露。

本地数据保存在忽略目录 `.data/postgres`，使用 **PGlite（嵌入式 PostgreSQL）**；重启保留配置、工单、会话、Prompt 和消息任务。Mock Worker 内置在 API 中，**不能再启动独立 Worker 访问同一个 PGlite 目录**。实际 Discord 模式要求外部 PostgreSQL，API / Bot / Worker 独立运行。

## 已实现

| 模块 | 可用能力 |
|---|---|
| 基础与后台 | TypeScript monorepo、React Console、服务端 RBAC、Discord OAuth2 Code + 一次性 state、HttpOnly 会话、CSRF / Origin 校验、限流、审计、只读 Guild 审计 |
| Lifecycle / Persona | 配置校验、草稿、发布、历史、乐观并发检查、回滚为待发布草稿、统一阶段 CTA、欢迎文案和 Prompt 模板 |
| 积分与奖励 | 规则草稿/审核/发布、账本与去重、等级/榜单、人工贡献、可选聊天计分和 Boost 核查；默认关闭，详见 [XP.md](docs/XP.md) |
| 欢迎 | 原生 Onboarding 完成后自动发布卡片；未启用引导时入群后发布；事件去重、重启不重发、不批量补发历史用户；`/welcome` 自助回退、持久化按钮查询当前配置 |
| Idea Machine | 20 条明确标记的 Mock 示例种子；生产示例种子禁用，需运营添加已审定种子；降重复抽取、每日生成限额、完整可玩游戏 Prompt 模板，无 Key 正常运行 |
| 工单 | [常驻面板与完整流程](docs/TICKETS.md)：主题表单、私密频道、接单/分配、内部备注与用户回复、关闭只读/重开、筛选分页、确认问题积分 |
| Messaging | 单频道纯文本、预览、草稿确认、立即/单次预约、取消、持久化交付回执、并发 Worker 抢占、429 延迟重试、异常状态人工核对、禁用群体 mentions |

生产功能开关默认全部关闭；`.env.example` 只有空变量名，秘密通过部署平台注入，不写入 Git。

## 后台语言

登录页及后台右上角的 **语言 / Language** 可切换 **简体中文 / English**。首次按浏览器语言选择，手动选择后在当前浏览器保存，刷新后保留；浏览器禁止本地存储时仍可在当前页面切换。导航、表单、状态、日期、确认提示和常见错误均支持中文。

切换语言不会改写未保存的输入、欢迎模板、消息正文、种子内容或 Discord 的英文用户文案；数据库字段、API 枚举和原始 JSON 诊断数据保留技术原值。

## 测试和构建

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

浏览器测试优先使用 `/usr/bin/chromium`；如果机器没有浏览器，先 `npx playwright install --with-deps chromium`。E2E 自己启动服务，使用独立临时数据目录；需要 3000 / 5173 端口空闲。测试截图与 trace 保存在被忽略的 `test-results/`。

可用**专用测试库**复跑同一集成套件：

```sh
TEST_DATABASE_URL='postgresql://…专用测试库…' npm test
```

注意：测试会 `TRUNCATE` 该数据库中的项目表，绝不能指向业务数据库。

生产构建后，`npm run api` 会同时提供构建好的 Console 和 API；默认 Mock 下可用 `npm run api` 单进程运行完整本地工作流。

## 文档

- [部署、变量、权限和回滚](docs/DEPLOYMENT.md)
- [管理员操作指南与 API](docs/OPERATIONS.md)
- [验收证据、范围及待办](docs/STATUS.md)
- [规格中的待审批决策 D-01–D-22](docs/spec/DECISIONS_TO_REVIEW.md)

## 明确的后续范围

积分规则、账本、等级、周月总榜和 Boost 核查已实现，默认计分关闭，使用方法见 [积分与奖励](docs/XP.md)。欢迎消息支持原生 Embed 卡片。Insights / AutoMod / Known Issues、DM 订阅、重复任务、通用图片/Embed 消息编辑器、多频道双人审批、完整数据保留与删除流程、付费 AI Provider 和生产观测仍属于后续里程碑。不做产品账号绑定 / VIP / 产品私有数据接口。

原生 Discord Onboarding 与现有频道/角色始终保留；唯一可能新建的服务器资源是运营批准分类内、用户主动请求的私密工单频道。注册命令及 Gateway 写入必须显式开启，安装和 Mock 启动不连接 Discord。

成员端积分卡片现统一为 **Evo Points**，含个人积分、周榜和月榜按钮。已有数据库可在后台生成确认分值的新草稿；安装源码不自动覆盖或启用现有计分。见 [成员卡片与更新步骤](docs/EVO_POINTS_CARD.md)。

Windows 已配置用户可在项目根目录双击 **Start.cmd**，统一启动 API、Caddy、Bot 和 Worker；**Stop.cmd** 停止本次启动的服务，**Status.cmd** 查看状态。首次使用及登录自启见 [Windows 一键启动](docs/WINDOWS_LAUNCHER.md)。

想使用 Mimo 图片图标和启动热键：保存图片后双击 **CreateShortcut.cmd**，选择图片。桌面生成 **Mimo - EvoMeme**，之后按 **Ctrl+Alt+M** 即可启动；见 [快捷方式说明](docs/MIMO_SHORTCUT.md)。

人员昵称、统一配置入口、超级管理员授权、运营数据和关键词风险审核见 [社区运营指南](docs/COMMUNITY_OPERATIONS.md)。新增数据从 Bot 更新运行后开始采集，不补采关机期间历史。
