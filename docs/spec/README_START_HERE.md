# EvoMeme Discord Bot + Community Console — Codex Handoff

版本：**PRD 1.0 / 待业务审核**  
整理日期：2026-10-22  
项目状态：**需求已汇总；尚未开发、尚未部署**

## 先读这 4 份文件

1. `EVOMEME_BOT_PRD.md` — 唯一正式业务需求规格，包含模块行为、数据结构、权限、安全和验收要求。
2. `DECISIONS_TO_REVIEW.md` — 业务尚未确认的决策清单；推荐默认值≠最终批准。
3. `IMPLEMENTATION_PLAN.md` — Codex 分期实施任务、交付物、测试清单和 stop conditions。
4. `CODEX_START_PROMPT.md` — 可直接复制给 Codex 的启动指令。

## 给 Codex 的总原则

- **先检查已有代码与 Discord 实际配置，禁止直接重建服务器。** 不创建、删除、重命名现有频道和身份组；除非用户通过 review 明确批准。
- 原生 Discord Onboarding 继续负责规则、频道和兴趣身份选择；Bot 只添加完成后的 Mimo 欢迎与趣味互动。
- **删除玩家账号绑定 / VIP / 产品私有数据接口范围。** 后台仅可使用 Discord OAuth2 进行员工登录，二者不可混淆。
- Bot 对外角色 **Mimo**，内部管理系统 **EvoMeme Community Console**。Mimo 视觉只使用经确认的原始品牌素材，不自动绘制或修改 logo/面部。
- 动态配置全部从数据库读取：阶段模式、欢迎语、按钮、链接、XP、Boost、规则、工单、私信及定时任务。
- 所有敏感/影响真实用户的操作必须有 RBAC、预览/确认、审核日志、幂等和错误处理；未经批准不得发送群体 DM。
- AI 分类、AI 提示词生成是**可选服务与可替换接口**：没有 API Key 时要优雅降级，不能阻塞所有功能。
- 用户未确定的参数，标明 `PENDING_APPROVAL`、使用安全默认值或保持功能关闭；不能装作已获批准。

## 当前项目范围

**必做的业务模块（5 项）：**
- 工单 Ticketing
- 舆情及风控 Insights & Moderation
- 积分、等级、排行榜及 Boost Rewards
- Messaging Center（消息/私信/定时/模板）
- Mimo Idea Machine（灵感→Prompt→产品导流）

**横向能力：** Mimo Persona、Lifecycle（预热/Web/App）、Onboarding 后欢迎互动、Console Dashboard、权限、配置版本、审计与可观测性。

## 交付形态

- 一个 Discord Bot + 一个 Web Admin Console + 后端/任务 Worker + PostgreSQL；建议 TypeScript monorepo。
- 至少包含本地启动方法、环境变量示例、SQL migration、自动测试、管理员操作说明、部署手册。
- 任何真实 Bot token、OAuth secret、模型密钥不得写入仓库。正式频道 ID / Guild ID / Role ID 由环境变量或后台安全绑定，不臆造。

## 需运营审核

首先阅读 `DECISIONS_TO_REVIEW.md`。P0 关键决策未批准前，可以搭好配置与测试桩，但**不得开启生产侧批量发送、自动处罚、付费行为奖励等相关开关**。
