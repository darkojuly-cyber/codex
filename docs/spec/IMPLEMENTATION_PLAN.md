# Codex 实施任务 / Milestones & Acceptance Gates

> 先按任务序列交付可运行增量，不允许“所有东西一口气用假数据做成看起来能用的后台”。每个里程碑须提供截图/测试/接口说明，得到业务验收再开启高风险自动化。

## M0 — Repository Audit & Foundation

**工作项**
- 检查项目仓库是否已有 Discord Bot/前端/数据库（不要覆盖已有工作）。
- 读取 `README_START_HERE.md`, `EVOMEME_BOT_PRD.md`, `DECISIONS_TO_REVIEW.md`。
- 定义 `env.example`（仅空变量名）、Docker Compose（dev PostgreSQL/Redis）、数据库迁移、TypeScript monorepo、lint/typecheck/tests、healthchecks。
- 后台 OAuth2 staff 登录、RBAC 服务端校验（mock + sandbox）、权限审计与 ID 映射工具。
- Mimo persona / configs / lifecycle 的 draft-publish / rollback 基础设施；本地 mock 库。

**DoD**
- `pnpm install`, `pnpm test`, `pnpm lint`, `pnpm dev` 正常（若选用不同包管理工具则在文档注明）。
- 没有 token 也能启动 mock UI，但明显显示 MOCK；没有后台权限的普通成员无法调用管理 API。
- Guild 审计脚本只读，不修改现有服务器任何设置。

## M1 — Welcome + Idea Machine + Tickets MVP

**工作项**
- Discord 原生 Onboarding 完成状态检查、去重 welcome、单一持久化欢迎卡片/可配置模板；`/welcome` 安全回退。
- `Surprise Me!` / `/idea`：seed library、有限随机、ephemeral prompt 生成与复制兼容显示、phase CTA。
- Prompt 模板 fallback；AI adapter 只暴露 interface，缺 Key 仍可用。
- `/ticket` 与 `Submit a Ticket`：Modal 核心字段、私密工单、安全权限、Ticket CRUD/状态、后台详情、日志。
- Messaging Center 立即发布和单次预约（先 sandbox guild）；模板、预览、allowed_mentions 防滥用。

**DoD**
- 完成 Onboarding 只发一次 welcome；不向历史成员群发；Mimo 人设和官方素材兼容。
- 工单只对用户与授权员工可见，且其它普通成员猜测 ID 也不能访问。
- PRELAUNCH 不暴露无效 Web/App 按钮；进入 WEB_LIVE 只有已配置 Web URL 才可显示。
- Discord 交互过程出现网络异常能提示并可恢复，不会有无权限的公开工单。

## M2 — XP / Boost / Rank + Messaging Scheduling

**工作项**
- `xp_rules` published revisions；ledger 幂等、计分 eligibility / 反刷机制、管理员调整原因、`/points rules`, `/rank`, `/leaderboard`, `/points history`。
- Booster 初次奖励与连续状态检查（生产发奖开关保持关闭，直到 D-03/04 批准）。
- 分周期快照、排行榜排期、消息中心重复任务、DM 偏好/订阅。
- 工单有效反馈/精选贡献经审核才触发 XP。

**DoD**
- 事件重放不重复发 XP、不重复送 DM；更改生效规则后历史账本不改变；权控阻止 Mods 擅自改规则。
- 周/月榜和账本算术一致，时间跨 DST/时区正确（后台时区可配置）。
- 拒绝接收 DM / 退订用户不会被再次发送非事务订阅通知。

## M3 — Insights & Intelligent Coordination

**工作项**
- Discord 原生 AutoMod 规则检查和管理接口（按实际权限）；Bot 违规告警记录与人工复核工作流。
- Topic 分类与趋势；可选 AI Adapter + Rule-only fallback。
- 异常告警、合并、静音、误报；日报周报；工单 issue group / 公示 known-issues 审核。
- 后台 Dashboard 指标计算和详情链接，覆盖采集限制提示。

**DoD**
- 权限不足不展示伪造的舆情覆盖率；不采集私密工单原文；警报可查看来源，能人工处理。
- Known Issues 从草稿发布前必须脱敏并经过 Staff 批准；正式对外用户消息不会含敏感内容。
- Taglish/Roman Urdu/讽刺语境在不确定时分类 unknown，避免自动处罚。

## M4 — Production Readiness

**工作项**
- 安全评估、合规告知与数据保留设置、数据删除流程、备份恢复、运行监控与错误看板。
- 配置对比/审批/版本回滚；Discord 原始频道与角色差异报告；角色和 Bot 权限审计。
- 小流量 canary (sandbox/test guild → production)、回滚程序、管理员培训手册。

**必须交付**
1. 前后端、Bot、Worker 可运行源码；不可只有静态原型。
2. 完整数据库 migrations/seed（seed 不创建生产真实用户）。
3. 管理界面可操作 + API 契约文档 + 指令清单。
4. 自动化测试及手动验收记录；至少 14 项 PRD 验收用例。
5. 配置说明、部署说明、权限/Intent 申请指南、安全与隐私配置。
6. 未决事项报告（未批准配置保持关闭）。

## 测试矩阵（最小）

| 场景 | 必测边界 |
|---|---|
| Welcome | 未完成、已完成、重入群、Bot 重启、缺少 GUILD_MEMBERS |
| Ticket | 多账号权限、失败回滚、附件、表单缺字段、重复工单、工单关闭/重开 |
| XP | 每日上限、重复刷消息、event replay、管理员人工加减、跨周/月、Boost 启停 |
| Messaging | 现在/未来/重复、撤销、429、消息权限不足、DM 不可达/退订、@everyone 注入 |
| Idea | seed 重复、AI 不可用、Prompt 完整性、按钮/URL 阶段变化、非法链接 |
| Insights | 无 MESSAGE_CONTENT、话题误报、禁用频道、私密频道排除、人工复核 |
| Admin | OAuth2 会话、角色变更、权限被撤销、CSRF、审计、回滚、secret 管理 |

## 决策型停止条件

- 未获得 Guild ID、Bot 凭证及频道 ID：只写 mock 与 sandbox，不部署生产。
- 未获 D-02：不可自动创建生产工单分类。
- 未获 D-03/04：Boost/积分真实发奖关闭。
- 未获 D-06：订阅型 DM 关闭，严禁群发推广 DM。
- 未获 D-07：未配置真实链接的 CTA 隐藏。
- 未获 D-10：违规自动处罚保持观察/报警模式。
- 未获用户审核品牌素材：不得生成新的 Mimo 官方角色图或新 Logo。
