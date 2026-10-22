# EvoMeme Discord Bot / Mimo + Community Console

> **产品需求文档 PRD v1.0（待运营审核）**  
> 日期：2026-10-22 · 语言：中文开发规格，用户端英文优先  
> 所有写作中的示例数据、XP 奖励数值、阈值及时间表均为拟定配置，不代表正式运营承诺。  
> **原则：保留现有 Discord 服务器，不擅改频道/角色；先 MVP，逐步增强。**

## 0. 项目目标与边界

**定位**：EvoMeme 官方 Discord 运营助手 **Mimo**，以及供 Staff/Mods 管理的 Web 后台 **EvoMeme Community Console**。覆盖：社区支持、风险管理、消息发布、参与激励、创意引导和产品阶段运营。

**目标闭环**：加入服务器 → Discord 原生 Onboarding → Mimo 趣味欢迎 → 探索灵感/参与讨论 → 创建/分享游戏 → 获得贡献激励 → 反馈/工单 → 运营复盘。

**阶段变化**：
- PRELAUNCH：重点向用户介绍 EvoMeme、引发兴趣；任何创作与下载 CTA 不能指向未上线产品。
- WEB_LIVE：引导从 Idea Machine 获取 Prompt，复制并前往 Web 创作。
- APP_LIVE：保留 Web 入口，另根据 iOS/Android 实际可用状态展示对应商店入口。

**非目标 / 必须排除**：
- 不做玩家 EvoMeme 账号绑定，不拉取玩家产品 UID、VIP 信息或游戏内数据；不能验证 Discord 用户确实注册/下载/创建游戏。
- 不重做 Discord 原生 Onboarding，不自建身份选择流程。
- 不做未经同意的批量私信/广告，不读取用户普通 DM 对话，不跨服务器收集数据。
- 不在没有权限/政策基础下全量持久化所有原始聊天，不能将 API 消息内容用于训练 AI。
- 不提供“自动补发积分后直接登顶”等硬编码结果；所有 XP 都是可审计账目。

## 1. 现有服务器结构：必须原样复用

来源：《EvoMeme_Discord服务器规划与运营配置方案_按截图原名》（2026-10-20）。频道与分类在计划稿中为 8 类、22 个频道（含 2 个语音）；生产实际 ID 以 Discord API 读取为准。**以下名称仅作为人工对照，不允许程序根据名称随意新建替代频道。**

| 分类 | 已有频道（按原文可见名称） | 计划用途 |
|---|---|---|
| START HERE | `👋 · welcome` · `📜 · rules` · `❓ · faq` | 欢迎、规则、问答 |
| OFFICIAL | `📢 · announcements` · `🎮 · weekly-picks` · `🎉 · events` | 公告、精选、活动 |
| COMMUNITY | `💬 · general` · `🎲 · play-and-share` · `😂 · meme-feed` · `🛋️ · off-topic` | 社区讨论和作品分享 |
| CREATOR LAB | `✨ · creator-chat` · `📚 · creator-guides` · `🧬 · remix-lab` | 制作/教程/Remix |
| SUPPORT | `🙋 · help-desk` · `💡 · ideas-and-feedback` · `📋 · known-issues` | 工单入口、建议、问题状态 |
| EVENTS | `gamejam` | 活动集中讨论 |
| STAFF ONLY | `🛡️ · mod-chat` · `📁 · case-notes` · `🤖 · mod-logs` | 内部协作、案例、日志 |
| Voice Channels | `Lobby` · `Gaming` | 语音 |

已存在自定义身份组（9 个，保持原有名称与权限）: `🔮 Staff`, `🛡️ Mods`, `🌟 Featured Creator`, `🧪 Playtester`, `🦕 OG Evolver`, `🎮 Player`, `🎨 Game Maker`, `🧬 Remixer`, `😂 Meme Hunter`。另有 `@everyone`。

- 按**Guild / Channel / Role Snowflake ID** 绑定，后台具备“从 Discord 拉取可选频道/角色”功能，并保存映射；显示名称只用作标签。
- 第一次部署进行**只读环境审计**：导出 ID、名称、类型、现有权限，标记 missing / insufficient permissions。不得自动修改频道权限或覆盖已有 Onboarding。
- 若工单需要创建私密频道，使用单独的**新建工单分类**（由运营审核名称/位置/权限，见 Review D-02），或使用现有授权私密 Thread/受控频道策略；不可在 STAFF ONLY 分类下错误暴露用户资料。
- 不给 Bot 整体 Administrator 权限；按功能精细授予 View Channel、Send Messages、Embed Links、Read Message History、Manage Channels、Manage Messages、Manage Threads 等必要权限；上生产前复核实际差异。

## 2. 人设与品牌：Mimo Persona System

**定位**：Mimo = `Meme Gremlin × Creator Buddy × Weird Bestie`，EvoMeme 紫色火焰幽灵；脑洞大、调皮友好、喜欢和用户一起玩、制作和分享游戏。默认英文面向国际用户，文案生动简洁，可适度用 meme、网络表达和 Emoji。品牌主张 `Anything Can Be a Game.`，常用 `Let's Make Games Together!`。

**常用语**（作为可编辑素材库，严禁每条消息机械重复）：
`What if we made this a game?` / `This is so dumb. I love it.` / `Bro, what did you just make?` / `Keep Cooking!` / `Can you beat this?` / `First game? That's huge!` / `Okay, but make it weirder.`

**场景语气**：欢迎/创意/排行轻快、俏皮；工单/违规/争议/申诉则清楚、专业、尊重，不用玩笑弱化处理结果。

**图像约束**：沿用现有官方 Mimo 2D 资产与 Logo。紫色火焰头部轮廓、弯曲火焰顶、斜向荧光绿眼睛、**单一原有嘴部**；不添加第二张嘴，不擅加下半身/腿/尾巴/耳机/服饰，配件仅在素材明确许可范围内使用；Logo 不变形、重绘或改变字形。Mimo 贴纸/表情来自已审定素材，不得由 Codex 自行生成替代角色。

**重要素材依赖**：运营已有 `ASSET_MANIFEST.csv`（EV-001/EV-002 原始官方 Logo；EV-003 原始 App icon；2D 角色参考等）。Codex 先要求或检查仓库内官方素材包，对照清单 SHA-256；没有文件时使用**明确写着 placeholder 的占位组件**，不得臆造 Mimo 图片。角色设定表 `EvoMeme紫焰幽灵角色设定表.png` 可作语气/行为参考，其探索性视觉不高于官方原图的约束。

**可配置项**：角色显示名称、欢迎模板、严肃/趣味语气、表情包映射、随机台词、频道回复策略、每阶段 CTA、提示词扩展 system template。版本化发布，支持预览与回滚。

## 3. Lifecycle Management（三阶段策略引擎）

单个 `active_phase`，可手动或预约切换；同时允许按渠道控制 `web_enabled`, `ios_enabled`, `android_enabled`（独立审核/上线）。所有模块订阅配置版本事件，原有消息和已排定任务的更新策略必须清楚。

| 作用点 | PRELAUNCH | WEB_LIVE | APP_LIVE |
|---|---|---|---|
| Mimo Welcome | 介绍产品、邀请探索/参与 | 游戏想法→Web 创作 | Web + 已开放商店 |
| Idea Machine 末端 | Copy/Save Prompt + Learn About EvoMeme | Copy Prompt + Open Web | Copy Prompt + Web/iOS/Android |
| Messaging | 预热/产品介绍模板 | Web 开放公告/教程 | App 商店/多端内容 |
| XP | 活跃、有效意见、创意主题 | 允许作品分享任务 | 作品分享及活动扩展 |
| 工单表单 | 预热/社区类问题 | Web、浏览器等字段 | Web / iOS / Android 类型可选 |
| Dashboard | 介绍按钮点击、首次互动 | Web 跳转量、Prompt 生成 | Web/商店点击（不等于下载） |

**运营阶段发布流程**：编辑草稿 → 校验必填链接 → 预览用户视角 → 指定 Staff 审批（如启用） → 现在/预约生效 → 版本记录 → 可回滚。切换不重新发送新人欢迎给已欢迎老用户；老用户上线提醒通过 Messaging Center 单独发公告。

禁止跳转到未配置/未开放链接；旧 welcome 常驻交互必须查询当前配置，已发送的 URL Link Button 若需变更须编辑原消息或使用合规的受控 URL 跳转服务。

## 4. Welcome（原生 Onboarding + Bot 趣味补充）

**Discord 原生**：规则、身份兴趣/频道选择完全在服务器原生功能中维护；Bot 禁止覆盖。**Bot 责任**：检测用户完成原生 Onboarding 后在 `👋 · welcome` 发送一次 Mimo 欢迎（频率/去重可配），加入 2–3 个互动按钮；按钮回执优先仅本人可见避免刷屏。

**触发**：优先基于 Guild Member 的 `COMPLETED_ONBOARDING` flag；监听成员状态更新 + 登陆后必要的状态补查。不要假设存在独立、保证到达的“完成 Onboarding”回调。成员离开重进、事件重投、Bot 重启不得重复刷欢迎；首次部署不批量欢迎历史成员。缺失 privileged member intent 时记录权限警告，提供可控的 `/welcome` 自助触发作为回退。避免通过未同意 DM 代替欢迎。

**阶段欢迎按钮**：
- PRELAUNCH：`What Is EvoMeme?`（已配置介绍地址/内容）、`Surprise Me!`（Idea Machine）、`Join the Fun`（已存在聊天频道）。
- WEB_LIVE：`Get a Game Idea`、`Create on Web`、`Explore Games`。
- APP_LIVE：`Get the App`（选 iOS/Android；只展示已开入口）、`Play on Web`、`Surprise Me!`。

**品牌体验**：单人不强制完成任务；1 次点击 10–20 秒内见到随机灵感；新手首条有效发言的积分与常规 XP 规则复用同一事件账本；不能因为点击提示词无限加分。

**追踪**：符合成员数据权限时统计 completion→welcome shown→button click→first valid activity。Discord Bot 不能仅凭公开 Link Button 自身获取外链点击事件；可考虑中转/带参数的归因 URL，但不得假装统计用户的注册/下载。

## 5. Ticket System（工单）

**入口**：既有 `🙋 · help-desk` 中由 Bot 维护可持久恢复的欢迎 Embed + `Submit a Ticket` 按钮；不要覆盖其他运营消息。

**创建流程**：
1. 点击按钮 → 弹出 Discord 原生 Modal，填写 `issue_type`（Bug / Creation Help / Account / Feature Request / Event / Other）、`summary`、`description`；版本、设备、环境、复现步骤按阶段动态收集。
2. 若原生 Modal 控件不足以一次完成所有收集，先收核心字段，创建私密会话后由 Bot 分步追问，截图/视频作为会话附件上传；**不要承诺 Modal 必定支持同一套复杂附件表单。**
3. 在经批准的工单分类中创建 private text channel 或其他**确保用户与被授权 Support Staff/Mods/Staff 可见**的受控会话，命名可用 `ticket-000123`。显式 deny @everyone 的 view permission。创建失败时不产生公开退化渠道，提示用户并记录错误。
4. Bot 发回编号、资料摘要、处理状态、补充附件指引；状态 `OPEN→INVESTIGATING→WAITING_USER→RESOLVED→CLOSED`，支持重开规则（可配置）。
5. Staff 可分配、内部备注、标记 duplicate / 关联 known issue；经审核才将**脱敏后**摘要/进度同步到 `📋 · known-issues`（论坛帖子），不得把私人工单原文公开。
6. 关闭前通知用户并按保留策略归档；数据库保留最小必要元数据和审计记录。

**后台**：过滤、搜索、优先级、SLA 计时（配置默认值）、负责人、标签、关联来源 Discord message、工单对话链接、重复问题组、Known Issues 审批发布；后台拥有私密工单访问的 RBAC 不能越权。

**额外规则**：同一用户并发工单数可配置；限流、防刷；新工单通知 `🛡️ · mod-chat` 或另配内部频道；操作记录 `📁 · case-notes` / `🤖 · mod-logs` 必须脱敏/按需记录。

## 6. Insights & Moderation（舆情与风控）

**监控范围**：仅有权限的指定公开频道（可从后台逐项开关），默认排除 `STAFF ONLY`、所有工单私密会话及敏感数据；如后续想分析工单数据，使用经过明确授权且脱敏的结构化标签，不直接全文送 AI。

**话题分类**：`BUG`, `GAMEPLAY`, `CREATION_DIFFICULTY`, `FEATURE_REQUEST`, `EVENT_DISPUTE`, `COMPETITOR`, `OTHER`；情绪仅作主题层聚合趋势（negative / neutral / positive / unknown），标识置信度，保留人工复核。

**统计和异常**：固定间隔滚动窗口（如 30 min）、话题消息量、独立用户、基准增长比、趋势、代表性原始**可访问消息链接**、待回应问题。异常预警先进入 `🛡️ · mod-chat`，并在 Dashboard 生成待办，不直接发布对外声明。阈值和冷却时间后台可编辑，预警需去重；能人工判误报及静音。

**风控**：优先复用 Discord 原生 AutoMod 阻止 spam、敏感词、外部广告和大量 mention。Bot 增加归档、规则审计、违规次数、删除已发出的明确违规内容（需 Manage Messages）、礼貌警告（优先 ephemeral/公开低扰动方式，DM 失败不视为处罚失败）。争议性或可能误判情境仅提示 Mods，人审后处罚；不要 AI 一判为负面就封禁。日志到 `🤖 · mod-logs`。

**报表**：每日 / 每周可按需生成（自动发送设置由消息中心控制），包含总讨论量、活跃独立人数、主题热度、正负面变化、Top Bugs、代表意见、建议、待回应列表及数据采样/权限覆盖说明。对 Taglish/Roman Urdu 等语言不稳定时应标注 unknown，避免误判。

**降级**：缺少 `MESSAGE_CONTENT` 时不声称全量舆情可用；显示权限受限，仍可正常运行工单 Slash Commands、Message Components、明确互动入口等替代能力。

## 7. XP & Rewards（积分、Boost、排行）

**设计原则**：奖励真实社区贡献，而非鼓励刷屏。两种数据：`lifetime_xp` 用于等级，`period_xp` 用于周/月榜；XP 账本为事实来源，读模型可重算。所有管理员加减分有原因、操作者及关联事件，不能直接改总分且无流水。

### 7.1 起始草案（所有数值 PENDING_APPROVAL）

| 触发 | 示例 XP | 上限 / 检查 |
|---|---:|---|
| 首次有效发言 | +10 | 用户一次，必须经过内容去重/最低有效条件 |
| 有效聊天 | +2 | 每日最多 +20；例如每用户每 60 秒计一次；字数/重复文本/机器人消息剔除 |
| 官方指定讨论 | +5 | 每日最多 +15，与普通聊天奖励是否叠加需审核 |
| 创作经验或作品分享 | +15 | 每日一次；经过审核或通过明确规则验证 |
| 有效、非重复 Bug/建议 | +20 | 人工确认，唯一 ticket/issue 只算一次 |
| 官方精选贡献 | +30 | Staff 手动授予，带 reason/source |
| 活动任务 | +10～50 | 每个活动单独版本规则 |
| 首次有效 Server Boost | +150 | 每用户该服务器首次一次，单次最高奖励 |
| 持续 Boost 30 天 | +50 | 按每 30 个完整且连续有效日发放一次，取消即停止后续奖励 |

**Boost 机制**：Discord guild member `premium_since` 及官方 Server Booster 角色/成员更新可作为当前有效的参考。实际事件可以重复、丢失，必须每日核对状态和幂等发奖。无法可靠按该字段识别用户拥有的每个 Boost 数量；**v1 按“用户当前是否为有效 Booster”计奖励，不按 boost 个数累计**。如果在 Bot 上线前已 Boost，应通过现存 `premium_since` 和配置的起算规则处理（需审核）。历史奖励不因取消 Boost 被自动扣减，但停发后续。不得承诺 Booster 自动排行榜第一，仍按 XP 正常排行；严禁诱导付费、用 XP 换现金等现实价值奖励。

### 7.2 后台

管理员可按规则增删/调整 XP、单日上限、冷却、适用频道、累计/互斥、是否启用、活动倍率、开始/结束时间、季度/周/月排行榜重置方式、等级阈值、身份组奖励映射（**不得赋予 Staff/Mods 等管理身份**）、Boost 逻辑、手工加/扣分和公告规则。

修改采用 `DRAFT → APPROVED → PUBLISHED`，存 version、admin ID、time、diff；**默认不追溯调整已发积分**。Event idempotency key 防重复发奖。并发更新需事务/锁或原子性；月/周归档时区可配置。

### 7.3 用户指令

- `/points rules` 最新已发布规则，明示 XP/上限/Boost、更新时间。
- `/rank` 本人等级、终身 XP、本周或本月名次。
- `/leaderboard [weekly|monthly|all_time]` Top N，可翻页，隐私与不良昵称过滤。
- `/points history` 本人最近积分流水。
- `/idea` 调用灵感机，不产生刷分。
- `/notify subscribe|preferences|unsubscribe` 由用户主动维护非事务类 DM 订阅。

管理指令：`/xp config`, `/xp give`, `/xp remove`，只对 Staff/授权运营，后台 RBAC 也要二次验证；编辑配置推荐在 Web 后台完成，Slash 管理命令可先只读或最小化。

## 8. Messaging Center（Bot 频道消息、私信、定时）

**后台页面**：Compose、Scheduled、Templates、History/Delivery Reports。

**渠道**：
- 指定频道发送（单/多频道）：文本、Embed、图片、附件（Discord 允许且权限充足时）、URL 按钮；可预览、测试发布、现在发布、预约、重复发送。
- 单用户 DM：仅在用户明确同意、发起支持请求或属于合理必要的事务通知条件下发送；DM 失败记录原因，不假设送达。
- 订阅型 DM：用户在 Bot 中自主 opt-in 指定通知主题，可随时 opt-out；严格禁止给服务器全部成员一键营销群发。

**限制**：消息面向用户的默认英文、文案应用 Mimo 人设。`@everyone/@here` 默认禁用，所有 `allowed_mentions` 显式白名单。发布流程必须支持草稿、管理员权限、测试消息、审批（对群体触达可强制）、审计日志、可取消、可编辑/删除 Bot 自己的历史消息（API 权限允许时）。

**任务执行**：持久化计划、UTC 存储 + 时区展示、重复规则 `RRULE` 或等价结构、Worker/Queue、幂等 `delivery_key`、容错重试和 429 Retry-After，重启后重放待发任务但不重复发；具体 message ID、channel ID、成功/失败持久化。不可依赖 Web 前端持续开着。

**效果统计**：可统计计划成功率、失败数、按钮 interaction 数及合法可见互动；不能假定有 DM 已读率/用户下载率。原生 Discord Link Button 点击无 Bot 回调，外链统计通过受控 HTTPS 重定向/链接参数（如产品方支持），并提供隐私提示。

**自动触发**：工单状态、舆情预警、欢迎、周榜、活动起止、Boost 感谢等共用同一消息引擎和模板管理；所有触发器可关闭。重复活动和用户通知均有节流。

## 9. Mimo Idea Machine（核心品牌互动）

**入口**：新人欢迎 `Surprise Me!`、常驻 `/idea`（可以后续增加已审批的入口消息）。

**流程**：
1. 从创意题库随机抽取不重复 / 降重复的 seed，也可以管理员手动精选。题库有 category、语言、phase、禁用题材、权重、status、版本。
2. Bot 在 **ephemeral** 响应展示 1 句荒诞但有趣的脑洞与 `Try Another Idea` / `Generate Game Prompt`。
3. Prompt Generator 将 seed 转换为**可执行游戏生成提示词**，至少包括：主题名称、核心玩法、操作方式、胜负/结束条件、明确计分与反馈、3–5 分钟目标时长（并非所有游戏必须严格固定）、画风、手机/桌面兼容、结算与可分享结果；不应只是描述故事或生成静态页面。
4. 展示完整 Prompt 和复制方式；注意 **Discord 本身的按钮不能直接操作用户系统剪贴板**，默认使用适合手动复制的 code block/文本 + `Open EvoMeme` URL。若需真正一键复制，需经审核设计 Web 页面或其他受支持组件（不能伪造可用的 Copy Button）。
5. 按 phase 决定 CTA。PRELAUNCH：`Save Prompt`（返回可复制文本）和介绍页；WEB_LIVE：复制 + Web；APP_LIVE：复制 + Web/iOS/Android 已开入口。
6. 鼓励用户自行将完成的游戏**主动**分享到 `🎲 · play-and-share`，可以获得审核后的 XP（无账号绑定时无法自动确认产品端创作成功）。

**生成策略**：AI 可选；没有 Key/模型出错则返回事先维护的高质量模板 Prompt；严格限制每人每小时/每天次数、超时、预算上限及敏感内容过滤。用户输入属于不可信文本，不准将其当系统指令；prompt injection 防护。AI 的语言可带 Mimo 趣味，但最终游戏 Prompt 需可用、清晰、有约束。若用户提交自定义灵感，先文本验证并受风控；生成内容不进行未经授权的公开发布。

**指标**：抽取次数、生成成功率、用户点击按钮数量、prompt 展示次数、产品跳转可观测次数；注册/游戏完成不能通过 Discord 自动确认。

## 10. Community Console（统一运营后台）

**页面导航建议**：
1. **Dashboard** — 新增成员、欢迎按钮互动、未结工单、今日预警、活跃人数、XP 发放、最常见话题、消息发布任务、当前 phase。
2. **Tickets** — 工单列表/详情/分配/SLA/关联 Known Issue / 管理员操作。
3. **Insights & Moderation** — 标签、趋势、阈值、自动审核记录、日/周报、风险处理。
4. **XP & Rewards** — 规则、等级、Boost、活动积分、排行榜、审计。
5. **Messaging Center** — 草稿、排期、DM、模板、发布历史、触达结果。
6. **Mimo & Idea Machine** — 人设口吻模板、角色素材引用、种子题库、AI prompt 模板、限额、预览。
7. **Lifecycle Management** — PRELAUNCH / WEB_LIVE / APP_LIVE、渠道可用开关、入口 URL、预览、预约发布、回滚。
8. **Settings** — 公会/频道/角色 ID 绑定、权限、机器人健康状态、API 与政策提示、操作日志。

**登录与授权**：后台员工使用 Discord OAuth2 Authorization Code + state + PKCE（按支持情况）+ session；登录成功仅代表身份验证，还必须从 Discord Guild/Role 校验是否 `🔮 Staff`、`🛡️ Mods` 或被授予专门的后台 staff 权限（专门白名单可配置且可审计），并做服务端 API 权限检查。后台登录 OAuth2 **不等于玩家 EvoMeme 账号关联**。

**RBAC 初始建议（待确认）**：
- `SUPER_ADMIN`：管理密钥配置、后台人员、全局和阶段发布、高风险权限。
- `COMMUNITY_MANAGER`：内容/XP/模板/报表/话题参数，部分操作需要审批。
- `MODERATOR`：审核和工单处理、舆情预警回复，不能自授积分/改规则。
- `SUPPORT`：只查看授权的工单与摘要，不能查看不相关内部数据。

**UI**：优先支持英文后台或中英切换（待审核），安全起见所有危险操作二次确认；列表筛选搜索、批量只读导出、审计页和错误提示。

## 11. 跨模块自动化事件

使用 event bus / outbox 事件表，事件名和 schema 版本稳定：

| Event | 触发 | 响应 |
|---|---|---|
| `member.onboarding_completed` | 确认 onboarding | Welcome 消息（仅一次） |
| `welcome.button_clicked` | 用户与 Mimo 互动 | Idea Machine / CTA 归因 |
| `ticket.created` | 有效工单 | 告知用户 + 内部通知 + 工单列表 |
| `ticket.issue_confirmed` | 管理员确认有效、非重复 | 可选给 XP、更新问题趋势 |
| `issue.alert_opened` | 舆情达阈值 | mod-chat + Dashboard 待办 |
| `issue.known_published` | 已知问题核准发布 | 更新论坛帖子 + 允许通知订阅者 |
| `member.boost_qualified` | 首次或持续资格满足 | XP Ledger + 感谢消息（如同意公开） |
| `xp.awarded` | XP 账目写入 | 更新聚合与排行，不触发额外 XP |
| `leaderboard.period_closed` | 定期结算 | 归档并发布周/月榜（按配置） |
| `lifecycle.published` | 运营阶段生效 | 更新欢迎模板、CTA、XP 可用规则、可发模板 |
| `message.schedule_due` | 任务到期 | Worker 发送并保存回执 |

每个事件具有 `event_id`, `guild_id`, `actor_id?`, `occurred_at`, `payload_version`, `source_key`，跨模块处理保证 at-least-once + idempotent consumer，杜绝重投重复奖励/私信。

## 12. 建议技术架构

Monorepo TypeScript：

```text
apps/
  discord-bot/            # discord.js Gateway + interactions
  admin-console/          # Next.js / React Web UI
  api/                    # Backend API, server-side RBAC, OAuth
  worker/                 # Scheduled messages, ranking settlement, reconciliation
packages/
  domain/                 # shared types, events, validation, rule engine
  db/                     # Prisma or Drizzle schema, migrations, repositories
  discord-adapter/        # Discord API wrapper and rate limit handling
  ai-adapter/             # mock/provider interface, fallback rules
  ui/                     # shared console components
config/                   # schema + safe defaults, no secrets
scripts/                  # permission audit, seed demo data, diagnostics
```

**建议栈**：Node.js LTS / TypeScript、discord.js、Next.js、PostgreSQL、Redis + queue（BullMQ 或等价）；容器化部署；结构化日志/错误监控、健康检查。必须能在没有 Discord token/AI key 时本地用 mock 跑后台与测试；生产环境缺少 token 时不能冒充运行正常。

## 13. 数据模型（第一版必需）

建议实体（按业务拆表、migration 管理，主键 UUID；Discord Snowflake 使用 string/bigint 安全存储，避免 JS 精度丢失）：

| Entity | 关键字段 / 唯一性 |
|---|---|
| `guild_config` | guild_id, active_phase, config_version, timezone, channel_map, role_map |
| `admin_membership` | discord_user_id, permission_role, guild_id, active, updated_by |
| `config_revision` | area, version, draft_json, published_json, authored_by, approved_by, published_at |
| `member_state` | guild_id, discord_user_id, joined_at, onboarding_completed_at, welcomed_at, boost_since, last_checked_at |
| `ticket` | id, seq, creator_id, guild_id, private_channel_id, category, status, priority, assigned_to, phase, created_at, closed_at |
| `ticket_event` | ticket_id, action, actor_id, metadata, occurred_at |
| `issue_group` | id, normalized_category, status, aggregate_count, known_issue_message_id |
| `ticket_issue_link` | ticket_id, issue_group_id, status, reviewed_by |
| `content_signal` | source_message_id/link, channel_id, topic, sentiment, confidence, sampled/retention flags, created_at |
| `moderation_case` | source_message_id, rule_id, action, reviewer_id, reason, status |
| `xp_rule_revision` | rule_id, version, event_key, points, cooldown, caps, channels, enabled, effective_at |
| `xp_ledger` | id, guild_id, user_id, amount, reason, event_key UNIQUE, rule_revision, actor_id, earned_at, effective_date |
| `boost_award_state` | guild_id, user_id, first_awarded_at, next_eligible_at, last_verified_at, current_boost_since |
| `leaderboard_snapshot` | guild_id, period_kind, start_at, end_at, user_id, xp, rank |
| `idea_seed` | id, title, seed_text, category, locale, weight, active, moderation_status |
| `prompt_generation` | id, user_id, seed_id, model_version, status, generated_prompt, expiry, usage_metrics (TTL) |
| `message_template` | id, name, purpose, phase, body, embeds_json, allowed_mentions, version |
| `message_job` | id, audience_type, audience_ref, schedule_utc, recurrence, status, approved_by, template_version |
| `message_delivery` | id, job_id, target_id, delivery_key UNIQUE, discord_message_id, delivered_at, status, error_code |
| `notification_preferences` | guild_id, user_id, topic, opted_in_at, opted_out_at |
| `event_outbox` | event_id UNIQUE, event_type, payload_json, occurred_at, processed_at |
| `audit_log` | id, actor, action, entity, entity_id, diff_summary, created_at, request_id |

**数据治理**：只收集业务必要字段；Ticket 的图片/文件引用遵守 Discord 链接生命周期（不能依赖附件 URL 永远有效），如需长期保留另行审核存储与保留策略；个人删除请求有流程，数据加密与访问控制；不将敏感内容直接发送 AI。审批与审计写入 append-only 逻辑记录。保留天数由运营/法务审核，在配置里明确。

## 14. 非功能性与安全要求

- **高可用/可靠性**：外部 Discord/API 失败不造成重复发送、重复计分；断网/重启可恢复；发送 429 尊重 `retry_after`，指数退避/上限和死信队列。
- **安全**：OAuth2 登录 state、最小 Scope、HttpOnly/SameSite session、安全密钥管理、CSRF/XSS 处理；服务器端 RBAC，不信任前端角色显示；避免任意 Webhook URL / SSRF；用户输入验证。
- **Discord 平台**：需根据功能配置 Gateway Intents（`GuildMembers` 及 `MessageContent` 为 privileged）；2026-06-11 起 Discord 以应用可访问用户数阈值审查 Privileged Intents，部署前以官方最新政策为准。不能擅自绕过限制。
- **审核行为**：AutoMod 优先，误判需人审，所有处罚可追溯。默认不自动封禁，不在敏感工单进行 AI 无授权处理。
- **可配置性**：Guild/频道/角色、运营阶段、XP/Boost、话术、链接、预警、私信模板在后台可编辑，有 draft/publish/revert；绝不写死在源码。
- **国际化**：用户端英文初期优先，预留多语言字段。日期在数据库 UTC，后台显示可选时区，避免跨日 XP 误算。
- **隐私**：明确服务器内容监控告知；用户可查阅积分变动和通知订阅，提供数据请求/退订处理。
- **质量**：单元/集成/E2E + 真实 sandbox guild 手动 QA，至少覆盖权限边界、重复事件、私密性、时区/日历、失败重试、阶段切换。

## 15. 关键验收用例（必须通过）

1. **只读 Discord 审计**：绑定现有 22 频道/9 自定义角色，不新建同名频道、不覆写 Onboarding 或已保存的权限。
2. **欢迎仅一次**：同一用户完成原生 Onboarding 得到 Mimo 欢迎；重启/重复成员事件不会收到重复欢迎；随机脑洞结果对点击者可见。
3. **阶段切换**：从 PRELAUNCH→WEB_LIVE，欢迎和 `/idea` 立刻采用 Web CTA，历史用户不被重复欢迎；APP_LIVE 某商店未配置链接时按钮不会显示。
4. **Mimo 稳定**：默认英文台词符合 persona；工单和违规消息严肃；官方 Mimo/Logo 文件与原始清单一致，未改变五官/比例。
5. **工单私密**：普通其他成员即使猜测工单 channel ID 也不能查看；管理员和本人可见；关闭、归档后无隐私泄露。
6. **Known Issues**：重复问题聚合后，必须人工核准脱敏内容才允许公开。
7. **舆情可控**：只有授权频道被采集，排除工单私密内容；预警可追溯到消息链接并可人工标为误报；无 Message Content Intent 时明确退化提示。
8. **XP 不重发**：相同事件重复投递 10 次只发一次 XP；修改规则仅影响新事件；`/points rules` 与已发布配置一致；周/月排行与账本吻合。
9. **Boost**：单次最高奖励按已批准配置；首次奖励不重复，多次 server 更新不重复；取消 Boost 后停止连续奖励；不能仅凭 booster 身份自动高权限。
10. **定时消息**：未来发送任务在服务重启后执行一次；取消任务不发；429 正确排队重试；`allowed_mentions` 默认不开放群体提醒。
11. **DM 订阅**：没有有效 consent 不会接收推广私信；取消订阅后不再发送；用户不可 DM 时记录失败；不会对所有成员批量私信。
12. **Idea Machine**：每个 Prompt 至少有玩法、输入、目标、胜负/结束、反馈、时长和结算；没有 AI Key 仍能生成预置 Prompt；在 Discord 中不显示伪造的 Copy-to-Clipboard 功能。
13. **权限**：Mods 无法修改 Staff 权限或任意积分规则；Support 只能看授权工单；所有操作有审计记录。
14. **安全**：无 secrets 入 Git；输入安全、CSRF、XSS、提示词注入风险验证通过。

## 16. 迭代范围（不要一次把所有功能写成一团）

- **V0.1 Foundation**：项目结构/认证/权限/配置/审计/频道映射、Lifecycle、Mimo Persona、Welcome、Idea Machine 题库/模板降级、工单 MVP、频道消息立即和单次预约。
- **V0.2 Growth**：XP Ledger、Boost 首次/周期资格检查、周/月/总榜、最新积分规则指令、XP/频道/活动后台规则管理、定时重复消息。
- **V0.3 Intelligence**：舆情分组/预警/报表、工单自动归类和 Known Issue、AI prompt 扩展、任务联动、完整 DM 订阅中心。
- **V0.4 Ops**：成熟的统一数据看板、异常回放、精细化活动计划、优化报表与更多语言。

**不可跨越的上线门槛**：私密工单权限验证、消息/DM 合规、真实 token 配置保护、平台 intents 审核、XP 幂等和用户数据保留策略审批。

## 17. 外部技术参考（2026-10，开发时复核最新版本）

- Discord Guild Member 对象：`premium_since`、`COMPLETED_ONBOARDING`：https://discord.com/developers/docs/resources/guild#guild-member-object
- Gateway Events / Guild Member Update：https://discord.com/developers/docs/events/gateway-events
- Application Commands：https://docs.discord.com/developers/docs/interactions/application-commands
- Discord AutoMod 官方说明：https://discord.com/safety/auto-moderation-in-discord
- Discord Developer Policy（DM consent / unsolicited marketing）：https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy
- Privileged Intents 2026 规则：https://support-dev.discord.com/hc/en-us/articles/40281523410967-Changes-to-Privileged-Intent-Access-for-Discord-Apps
- Bot Rate Limits：https://support-dev.discord.com/hc/en-us/articles/6223003921559-My-Bot-is-Being-Rate-Limited

**待审批项以同目录 `DECISIONS_TO_REVIEW.md` 为准；未批准值不能以“已确认需求”的口吻实现生产行为。**
