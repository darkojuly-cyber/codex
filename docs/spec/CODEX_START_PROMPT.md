# 给 Codex 的启动指令（复制整段）

请把当前仓库作为 **EvoMeme Discord Bot + Community Console** 项目处理。先阅读以下四份文件：

- `README_START_HERE.md`
- `EVOMEME_BOT_PRD.md`
- `DECISIONS_TO_REVIEW.md`
- `IMPLEMENTATION_PLAN.md`

开发前先检查仓库现状，不要假设是空仓库、不要覆盖已有配置，不要删除/新建/重命名 Discord 已有的频道或身份组。

开始执行 **M0 Foundation**。如果仓库已有代码，先报告当前结构与最小改造方案；若为空仓库，按 PRD 推荐 TypeScript monorepo 生成可运行基础工程。

优先输出：

1. 现有工程审计（有/无已有文件）、架构和关键技术选择。
2. 与 PRD 对应的依赖图与可追踪任务列表。
3. 必需环境变量列表与 `env.example`（绝不写实际 Token）。
4. 数据库初版 schema 和 migrations；支持版本化配置与审计。
5. 可运行的 Admin mock 首页、生命周期阶段配置与 Mimo persona 配置原型；员工登录与 RBAC 接口骨架。
6. 最小 CI/typecheck/lint/test、启动与测试说明。
7. 报告所有 `PENDING_APPROVAL` 项，绝不伪装为已批准；有高风险生产侧操作必须默认关闭。

**业务规则**：
- 产品玩家**不绑定** EvoMeme 产品账号；后台员工使用 Discord OAuth2 身份认证允许。
- Discord 原生 Onboarding 不替换；Bot 完成后补充 Mimo 欢迎/随机创意。
- Mimo Persona 不得私改原形；官方视觉素材不在仓库时使用标注清楚的 placeholder，不自动绘制。
- 运营阶段 PRELAUNCH、WEB_LIVE、APP_LIVE 的欢迎、Idea Machine、外链及 XP 功能由统一后台动态配置。
- 工单、舆情、积分/Boost、消息中心、Idea Machine 五大业务模块的规格以 PRD 为准。
- 不要对真实 Discord 用户/服务器做写入、发消息、自动处罚、真实 XP 发奖或 DM 发送，直到获得明确上线确认与测试公会环境。

这轮以 **可运行 M0 + 审计报告** 为完成标准，不要偷跑 M1～M4；每完成一个里程碑，都展示改动文件、测试通过情况及尚待审核的事项。
