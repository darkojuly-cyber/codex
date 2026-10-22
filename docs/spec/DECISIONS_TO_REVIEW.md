# EvoMeme Bot — 待运营审核 / Decision Register

更新时间：2026-10-22  
用途：以下事项尚未被用户明确最终批准。**推荐值是为了让 Codex 能写配置/测试，不表示可以上生产。**

## A. 最高优先级：建议运营审核后才开启实际服务

| ID | 待确认问题 | 推荐默认 / 选择 | 未批准时 Codex 应怎么做 | 状态 |
|---|---|---|---|---|
| D-01 | 欢迎消息展示形式与频道 | 在现有 `👋 · welcome` 发送一次可见欢迎；Mimo 按钮后的内容为 ephemeral；只 @ 当前新用户，不私信 | 允许 staging 测试，默认禁用批量补发给历史成员 | PENDING_APPROVAL |
| D-02 | 私密工单承载方式 | 创建独立 `TICKETS` **新分类**并自动生成 `ticket-xxxxxx` 私密文字频道；仅工单本人/授权员工可见；先人工审批新分类 | 先实现权限模拟和 sandbox 测试；不在生产自动新建分类 | PENDING_APPROVAL |
| D-03 | XP 规则数值（含 Boost） | 采用 PRD 起始数值：首次 Boost +150 XP，连续有效每 30 天 +50；最高**单次**奖励但不保送排行榜第一 | 规则配置可编辑、测试数据演示，生产奖励自动发放关停 | PENDING_APPROVAL |
| D-04 | Boost 历史用户如何算首奖 | Bot 上线时当前有效 Booster 也给一次首次 +150 XP（经运营确认名单/起算日）；过去已取消的不补 | 不追溯自动发放，显示待审核队列 | PENDING_APPROVAL |
| D-05 | XP 计分区/规则叠加/公平性 | 公开讨论频道计普通发言；`off-topic` 不计；`meme-feed` 可计但严控刷屏；官方讨论与普通发言**不叠加** | 后台预置可编辑草稿；不开生产计分直到确认 | PENDING_APPROVAL |
| D-06 | DM 允许范围 | 一对一支持通知 + 工单事务提醒 + 用户**明确订阅**的 Bot 功能性提醒；**不做群体广告/营销 DM** | 默认关闭订阅型通知；仅用户直接请求的回复可工作 | PENDING_APPROVAL |
| D-07 | Web / App / 介绍产品真实 URL | 分别配置 `PRODUCT_INTRO_URL`, `WEB_CREATE_URL`, `IOS_STORE_URL`, `ANDROID_STORE_URL`；阶段开关决定按钮是否可见 | 缺少真实可用链接时不显示对应 CTA，不得编造链接 | PENDING_EXTERNAL_INPUT |
| D-08 | AI Provider / 预算 / Prompt 模板 | AI 接口通过配置抽象；每人每日 5 次 Prompt 扩展作为草案，种子抽取可以更多；可关闭 AI | 默认 `MOCK_AI=true`，用高质量预置模板，不能生产调用收费 API | PENDING_APPROVAL |
| D-09 | Bot 实际频道 ID/角色 ID/权限 | 只读从现有 Discord 服务器同步选择，并由运营审核绑定 | 不用频道名称模糊匹配后自动创建/删除；缺少 Guild/Role IDs 则运行本地 mock | PENDING_EXTERNAL_INPUT |
| D-10 | 是否允许自动删除/警告/处罚 | 高确定性 spam/恶意链接使用 Discord 原生 AutoMod；删除动作先由 Staff 开关启用，严重处置人工审核 | 默认 **shadow/test 模式仅记录和告警**，不自动封禁/踢人 | PENDING_APPROVAL |

## B. 可以先做成后台配置、不阻塞底层架构

| ID | 待确认问题 | 推荐默认 | 开发处理 | 状态 |
|---|---|---|---|---|
| D-11 | 管理后台显示语言 | 后台中文或中英切换；用户 Bot 文案英文 | 国际化词条分离，不锁死语言 | PENDING_APPROVAL |
| D-12 | 首发时是否必须有审批流 | 高影响消息（多频道/订阅群体）、阶段切换、XP 新规则必须审批；普通单频道可由 Publisher 发布 | 先做权限和单人确认，再做双人审批 UI | PENDING_APPROVAL |
| D-13 | XP 等级/身份奖励 | 独立 XP 等级（可用 L1/L2...），可选新荣誉角色；**不覆盖已有9个身份组** | 表结构和设置页先就绪，生产角色自动授权先关 | PENDING_APPROVAL |
| D-14 | 排行榜结算周期与时区 | Asia/Singapore 周一 00:00、每月 1 日 00:00；All-Time 常驻 | 时区/周期可改、测试跨时区计算 | PENDING_APPROVAL |
| D-15 | 舆情预警阈值与日报/周报 | 初期仅用于运营校准：30分钟内同类负面≥10条、涉及≥5人、相较常态≥3倍；每天/每周汇总 | 告警默认推内部 `🛡️ · mod-chat`，不自动对外回应 | PENDING_APPROVAL |
| D-16 | 工单限额、关闭/重开、SLA | 每用户最多 2 个活跃工单；关闭前提示；7 天内可重新打开（建议），具体 SLA 待定 | 配置可更改；超时仅提醒，不自动关闭 | PENDING_APPROVAL |
| D-17 | 周榜公告和欢迎感谢消息频率 | 周榜仅在运营指定频道发布；Boost 感谢默认不公开点名，用户可同意 | 先做模板与 opt-in，防刷屏 | PENDING_APPROVAL |
| D-18 | Idea Seed 初始题库和内容审核 | 运营审定 ≥20 个英文种子，避免政治/宗教/地域刻板印象、攻击性内容；先人工维护题库 | 提供种子导入界面和安全示例，正式投产前运营确认 | PENDING_APPROVAL |
| D-19 | 数据保存期限与隐私告知 | 原始社区消息不做长期全文存储；只存最小 topic 元数据；私密工单与积分流水分别定义期限 | 代码需支持 TTL、删除、导出接口；真实保存期限待法务/运营定稿 | PENDING_APPROVAL |
| D-20 | 运营阶段何时切换 | 手动发布优先，可预约生效；不在文档中臆造发布日期 | 初始 PRELAUNCH，运营确认后可切换 | PENDING_APPROVAL |
| D-21 | 定时消息重复投递的时区与审批 | 默认 Asia/Singapore 展示，数据库 UTC；循环遵守用户时区/日历计算 | 支持自定义和安全模拟 | PENDING_APPROVAL |
| D-22 | 正式支持的语言和本地化顺序 | 初期英文；Taglish 和 Roman Urdu 作为后续审核版本，不自动生成未审过翻译 | Schema 支持多语言/备用值 | PENDING_APPROVAL |

## C. 已明确决定，不要再重复追问

- 产品账号绑定/产品内部 UID/VIP 功能：**取消**。
- Onboarding：**使用 Discord 服务器原生功能**，Bot 只补充 Mimo 欢迎和趣味玩法。
- Bot 公众角色：**Mimo**；人设为 `Meme Gremlin × Creator Buddy × Weird Bestie`，遵循既定官方 2D 视觉，不擅加嘴/尾巴/耳机。
- 引导分 PRELAUNCH→WEB_LIVE→APP_LIVE 三阶段。Web 上线导 Web；App 上线后 Web 与已开放商店可并存。
- Idea Machine：**随机创意 + 游戏 Prompt + 产品链接**，新人按钮与 `/idea` 都能使用。
- 后台：统一 Web Console 管工单/舆情/积分/消息/Idea Machine/阶段与人设。
- 积分规则：**必须有后台动态配置**，用户 `/points rules` 能看到最新已发布规则。
- Boost：需要较高优先的积分奖励，但具体数额和反刷规则仍需最终批准。
- 消息中心：以 Bot 身份发频道消息与合规 DM，可预约、循环、模板和历史。
- 频道名称、角色名称：以既有截图/运营文档为准，不允许 Codex 私自修改。

## D. 审核模板（供运营填写）

```
D-01：通过推荐方案 / 修改为 ______
D-02：通过推荐方案 / 修改为 ______
D-03：首次Boost ___ XP；每30天 ___ XP；是否进总榜：是/否
D-04：旧 Booster 是否补发：是/否
D-05：计分频道及是否叠加：______
D-06：DM 范围：事务提醒 / 订阅型功能提醒 / 其他 ______
D-07：产品介绍 URL ______；Web 创作 URL ______；iOS URL ______；Android URL ______
D-08：AI Provider ______；每日生成上限 ______；预算上限 ______
D-09：Discord Guild ID / 频道 ID / 角色 ID：后台连接后获取（不在聊天里提交 Token）
D-10：自动处罚策略：审核模式 / 自动删除确定性违规 / 其他 ______
其余 D-11～D-22：可先按推荐默认进行开发，正式上线前再逐项确认。
```

注意：业务决定与平台政策存在冲突时，以平台约束为准；例如订阅并不意味着允许无关广告 DM、管理权限不可通过 XP 购买/取得。
