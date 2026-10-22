# 管理员操作指南与 API

## 工作流

### 本地 Mock

`npm run dev` → 本地 Console 登录页选角色。此模式无 Discord 网络访问。Dashboard 统计来自真实本地表，不自动造用户/工单/积分数据。

1. **Mimo & Ideas**：Surprise Me → Generate Game Prompt，生成可复制的完整文本。每日 UTC 限额从发布配置读取；抽种子每用户每小时最多 60 次，最近三次抽取降重复。
2. **Test private support**：创建 Mock ticket；在 Tickets 查看、分配并写理由更改状态。Support 只可查看自己创建/分配给自己的工单，其他 ID 返回 404；Mods 可处理工单但不能修改配置或发消息。
3. **Settings**：输入已审定频道 Snowflake IDs（本地测试可以明确使用测试 ID）→ Save configuration draft。
4. **Lifecycle**：Inspect 草稿可查看完整内容和对应预览 → Publish 明确确认。配置冲突会要求刷新，不能静默覆盖。Restore as draft 不立即发布。
5. 启用 messaging 前绑定发布频道白名单；编辑和保存新草稿，确认后发布。
6. **Messaging**：填单个白名单频道 ID、纯文本和时间 → Save draft → 检查预览 → Confirm delivery。空时间为立即；浏览器本地时间转换 UTC 后入库。后台时区字段用于配置，当前列表显示的是浏览器本地时间，并在表单明确说明；未实现可选后台时区格式化。
7. 任务执行不依赖浏览器页面打开。Refresh 查回执；关闭重开服务后继续处理未发任务。未来任务可取消；SENDING 已被 Worker 抢占的任务不可保证取消，API 拒绝取消。

Mock 模式中的频道/消息 ID 带 `mock-` 前缀，不能用于真实 Discord。PGlite 落盘数据重启保留；勿同时启动另一个 API 访问同一目录。需要重置本地测试数据时先停止自己启动的进程，再备份/移走相应 `.data` 子目录；不删除未知用户文件。

### 真实 Guild 的用户命令

| 命令 / 组件 | 行为 |
|---|---|
| `/welcome` | ephemeral 欢迎卡片，替代缺少成员 Intent 的自动触发；不替换原生 Onboarding |
| `/idea`, `Surprise Me!`, `Try Another Idea` | ephemeral 创意卡片；种子必须 active / 已审核 |
| `Generate Game Prompt` | 限额检查、持久化模板生成；完整 Prompt 以 `.txt` 附件供选择复制，不伪造剪贴板按钮 |
| `Explore EvoMeme` | 查询最新已发布阶段配置，按可用 HTTPS 链接展示 CTA |
| `/ticket`, `Submit a Ticket` | 核心字段 Modal → 已批准分类中显式私密频道；不提供公开降级 |

表单类别精确支持 `Bug`, `Creation Help`, `Account`, `Feature Request`, `Event`, `Other`。Account 仅为通用支持分类，不绑定产品账号、不要求产品 UID/VIP。所有普通消息默认禁止 ping；自动欢迎只白名单提及当前新成员。附件在工单频道手动补充；本版不下载、持久备份 Discord 附件。

本版未注册 `/points`, `/rank`, `/leaderboard`, `/notify`, `/xp`，因为相应里程碑尚未实现，不能宣称存在。

### 权限

| 操作 | Super Admin | Community Manager | Moderator | Support |
|---|---|---|---|---|
| 配置 / 版本 / seed / 只读 Guild 审计 | 是 | 是 | 否 | 否 |
| 消息草稿、确认、取消、回执 | 是 | 是 | 否 | 否 |
| 查看/处理所有工单 | 是 | 是 | 是 | 否 |
| 自己创建/被分配的工单 | 是 | 是 | 是 | 是 |
| 审计列表 | 是 | 是 | 是 | 否 |

没有后台自助提权接口。Guild 角色和超级管理员白名单由部署配置控制。角色每次 API 请求重新查询；Discord 无法确认 membership 时拒绝访问。已登录但无授权角色的普通成员不会被授权。

## API 契约（V0.1）

同源 JSON API；除列出的认证入口 / health 外必须有有效会话 cookie。写请求必须有可信 `Origin`、JSON Content-Type 和会话返回的 `X-CSRF-Token`。不接受 `X-Role` / 客户端传入权限。错误格式 `{"error":"CODE","fields":[…]}`，fields 仅校验错误存在。

| Method | 路径（`/api` 前缀） | 输入 / 返回 |
|---|---|---|
| GET | `/health` | 模式、数据库、自身存活；**不是 Gateway 连通性证明** |
| POST | `/auth/mock` | 本地 `{role}` → 模拟 session；真实模式 404 |
| GET | `/auth/discord` | 302 到 Discord identify 授权 |
| GET | `/auth/callback` | code + 一次性 state，浏览器 state cookie → 员工 session |
| GET | `/session` | `{userId,role,csrf,mode}` |
| POST | `/logout` | 撤销 session，审计，不保留 Token |
| GET | `/dashboard` | 角色可见未结工单数、当前 phase、消息状态计数、能力限制 |
| GET | `/config` | `{current,revisions}`，最多 50 版 |
| POST | `/config/drafts` | 完整 Config 对象，Schema 见 `packages/core/src/config.ts` |
| POST | `/config/:id/publish` | `{expectedVersion,confirm:true}`，原子替换已发布版 |
| POST | `/config/:id/rollback` | 从旧版复制新草稿，不直接生效 |
| GET | `/preview` | 当前已发布 persona / phase / CTA / 占位说明 |
| GET | `/tickets` | 按服务端角色过滤列表，非 Support 最多 200 条 |
| GET | `/tickets/:id` | 授权详情 + 私有事件 |
| PATCH | `/tickets/:id` | `{status,note,assignedTo?}`，reason 必填、重开窗口和限额检查 |
| GET / POST | `/seeds` | 列表；新增 `{title,seed_text,category,approved}`，approved=false 保持 inactive |
| GET | `/messages` | 最近 100 任务及 attempts / error / Discord message ID |
| POST | `/messages` | `{channelId,body,scheduledAt}`，ISO8601 带时区，创建草稿 |
| POST | `/messages/:id/confirm` | `{confirm:true}`，创建唯一持久化 delivery |
| POST | `/messages/:id/cancel` | 仅 draft / scheduled / retry，可审计 |
| GET | `/audit` | 最近 200 条，不向 Support 暴露内部日志 |
| GET | `/discord/audit` | 只读 Guild / Channels / Roles 原始信息；包含敏感权限配置，限 Staff |
| POST | `/mock/idea` | Mock 本地种子抽取 |
| POST | `/mock/prompt` | Mock `{seedId}` → 完整 Prompt |
| POST | `/mock/ticket` | Mock `{requestKey,input:{category,summary,description}}` |
| POST | `/mock/tick` | Mock 手动执行一次 Worker，仅调试 |

Config 的未知字段被拒绝；所有 `:id` 必须 UUID，Discord IDs 为 17–20 位字符串，不转成 JS Number。没有任意 URL 抓取/Webhook 接口，无 SSRF 入口。React 默认文本转义，不使用 `dangerouslySetInnerHTML`。

## 失败处理

`SENT` 是 Discord 已接受并存入 message ID；不等于已读。`FAILED` 记录明确失败/重试耗尽；`UNKNOWN` 是外部操作结果无法确认。UNKNOWN 不自动重发：运营先核对 Discord 的消息/频道；必要时复制新草稿并确认，接受可能重复的后果。本版没有“标记成功”或盲目重试按钮。

关闭工单前先在私密频道与用户确认；后台只记录状态，不自动向用户发通知。重新打开必须在配置窗口内，且不超过活跃工单限额。内部备注不会公开发布。没有 Known Issues 发布入口，不能将私人工单一键转公开。

## 架构说明

`apps/admin-console` → `apps/api` → `packages/core` → `packages/db` / Discord adapter。Gateway 调用同一 core service；Worker 使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 抢占持久任务。Mock API 内置单 Worker，复用相同业务代码和 SQL。`event_outbox` 存稳定 source key 和版本化事件供后续消费者；当前无需额外 Redis/BullMQ，也没有声称 outbox 已驱动全部跨模块自动化。

PGlite 和 PostgreSQL 使用相同 schema；数据库绑定一个模式 / 一个 Guild，禁止 Mock / 真公会混用。原始库文件在 `.data`，不提交 Git；启动外部 PostgreSQL 不需要 Redis。未来添加队列再引入 Redis，当前用 PostgreSQL 即可实现持久单次预约。
