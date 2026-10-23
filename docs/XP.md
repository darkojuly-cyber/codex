# 积分与奖励（V0.2 增量）

## 已实现

- 后台“积分与奖励”中英文页面：规则增删、启停、分值、适用频道、冷却、每日积分上限、有效时间、结算时区和等级门槛。
- 独立积分规则版本：草稿 → 审核 → 发布。记录原因、创建人、审核人、发布人和时间；旧版可恢复成新草稿。当前允许同一名已授权运营审核和发布，不强制双人审批。
- 追加式积分账本：每笔包含成员、正负积分、来源、原因、操作人、规则版本和规则快照。没有修改总分或删除历史的接口；扣分不能超过余额。
- 同源事件去重、事务内冷却与日上限。首次发言、官方讨论、普通聊天择一，不叠加。首次发言、首次 Boost 按成员终身一次，改规则不重置资格。
- 聊天反刷：剔除机器人、Webhook、系统消息和低有效字符数内容；对最近 24 小时已奖励的重复内容进行哈希去重；不保存消息全文。仅指定频道计分。
- 人工审核作品、有效问题、精选贡献、活动参与。问题/作品/精选来源全局去重；同一活动每位成员只能领取一次。来源 ID 应由运营稳定命名，不能每次重新随机生成。
- Boost 成员更新监听和 Worker REST 核查：首次有效资格、每完整连续 30 天奖励、取消后停发。按用户有效状态计分，不按 Boost 个数累加；不会自动授予管理角色。
- 等级、周榜、月榜、总榜；周从配置时区的周一开始，月从 1 日开始。账本实时汇总，不删除历史或重置总分。并列积分同名次，分页以成员 ID 稳定排序。
- `/points rules [page]`、`/points history [page]`、`/rank`、`/leaderboard [period] [page]`，以及欢迎卡的 **XP Rules** 按钮。响应仅自己可见，榜单提及不会 ping 用户。历史查询仅本人。

## 默认状态与边界

默认总开关和每条规则均关闭。规格中的数值被载入为可编辑的停用草案；没有因安装代码而批准任何实际奖励。等级门槛同样可编辑。必须检查后分别审核、发布并启用才会计分。

新规则只处理发布后的新事件，不追溯重算账本。等级门槛变更后会按当前门槛重新展示等级，账目金额不变。点击欢迎、灵感或提示词按钮不加分。作品、Bug 和活动不依据产品端数据自动判断，运营通过后台审核后奖励。

Boost 只跟踪 Bot 运行时实际观察到的 Boost 状态变化，不批量扫描或给安装前的 Booster 补发首奖。新观察到的有效 Boost 在每次核查时通过 Discord REST 复核；成功核查间隔 6 小时，失败 5 分钟后重试，失败不推断取消或发奖。连续期有停机时，仅处理核查时最新一个已完成周期，不批量补发漏掉的历史周期。历史名单/补发政策、荣誉角色自动发放、周期榜快照和自动公告仍未实现。

没有聊天内容 Intent 时，规则查询、等级、手动奖励、审核贡献仍可用；自动聊天奖励不可用。没有成员 Intent 或未运行 Worker 时，不能承诺 Boost 自动核查完整运行。

积分没有现金价值，不兑换管理员权限。数据保留、删除和导出政策仍需运营制定；当前账本不会自动过期。

## Windows 更新与启动

更新前只停止本项目的 API、Bot、Worker，Caddy 可继续运行。将最新版 ZIP 解压到临时目录，把 **含 package.json 那一层的内容** 合并到项目根目录，保留 `.env`、`.env.local`、`.neon`、`.data` 和自定义 `neon.ts`。不要把整个同名文件夹再套进项目内。

```powershell
Set-Location -LiteralPath "D:\Discord bot\codex-evomeme-v0.1"
npm ci
npm run build
```

安装/构建任何一步失败先处理错误，不要继续启动。按原配置启动 API，首次启动会自动应用新增的 `002_xp.sql`，不会清空原有配置和数据。API 完成启动后，再注册命令和启动 Bot。注册会替换该应用在配置 Guild 的命令集合：

```powershell
$env:APP_MODE = "discord"
$env:PUBLIC_ORIGIN = "https://localhost:8443"
$env:DISCORD_WRITES_ENABLED = "true"
npm run bot:register
npm run bot
```

需要自动聊天计分时，在 Developer Portal → Bot 开启 **Message Content Intent**；在启动 Bot 的终端设置：

```powershell
$env:MESSAGE_CONTENT_INTENT = "true"
```

需要自动欢迎和 Boost 时，同样开启 **Server Members Intent**，并设置 `GUILD_MEMBERS_INTENT=true`。管理员权限不能替代 Gateway Intents。

在独立终端运行 `npm run worker`，沿用同一真实模式与 PostgreSQL 配置。Worker 负责 Boost 定期核查和已有消息队列。只启动 Bot 而不运行 Worker，不提供周期奖励保障。

## 后台操作

1. 打开 **积分与奖励**。检查初始草案，按需修改规则、频道 ID、上限、冷却、时区和等级门槛。
2. 总开关与需要的单条规则分别启用。消息类规则必须填写真实频道 ID；非消息规则不使用频道限制。
3. 填写修改原因，保存积分规则草稿。
4. 在版本历史载入并检查该草稿，点击“审核通过”，再点击“发布积分规则”。此流程独立于欢迎/生命周期配置。
5. 在 Discord 使用 `/points rules`，核对版本、开关、数值及更新时间。没有自动发分需求时可保持总开关关闭，只测试查询。
6. 人工加减分需填原因；审核贡献需填写真实成员 ID、贡献类型、固定来源 ID 及审核说明。记录在积分流水和全局审计中。

## API

所有 API 沿用 session、Origin、CSRF 和角色验证。`SUPER_ADMIN`、`COMMUNITY_MANAGER` 可编辑规则和发奖；Mods/Support 不能通过接口绕过页面限制。

| 接口 | 用途 |
| --- | --- |
| GET `/api/xp/config` | 运营规则版本、最近 100 笔账目和 Boost 核查状态 |
| GET `/api/xp/rules` | 最新已发布积分规则 |
| GET `/api/xp/me` | 当前员工本人积分、等级和名次 |
| GET `/api/xp/history?page=1` | 当前员工本人最近流水 |
| GET `/api/xp/leaderboard?period=weekly&page=1` | 每页 10 人榜单 |
| POST `/api/xp/drafts` | `{config,reason}` 保存草稿 |
| POST `/api/xp/:id/approve` | 审核草稿 |
| POST `/api/xp/:id/publish` | `{expectedVersion,confirm:true}` 乐观锁发布 |
| POST `/api/xp/adjustments` | `{userId,amount,requestKey,reason}` 加扣分；requestKey 为本次操作 UUID，重试必须复用 |
| POST `/api/xp/contributions` | `{userId,event,source,reason}` 审核贡献 |

目标成员在真实模式下通过 Discord membership 验证，机器人不参与。消息自动奖励和 Boost 验证不是可由浏览器提交的公共事件接口。

## 验证与限制

单元/集成测试覆盖两个 PostgreSQL 实现：本地 PGlite 与独立 PostgreSQL；涵盖十次并发重放、事务限额、时区日界、账目更正、版本发布、私密流水和权限、Boost 取消与失败核查。Playwright 验证真实页面的规则审核发布、人工调整、贡献去重、排行榜、中英文和移动布局。

这些测试使用本地模拟 Discord 响应，不代表已在你的 Neon 数据库迁移或真实 Guild 发奖。真实 Gateway、平台 intents 与网络路径需要更新到本机后再验收。未重新构建/发布 Docker 镜像。

验证结果（2026-10-23）：`npm run lint`、`npm run build` 通过；PGlite 与 PostgreSQL 各 62 项测试通过，7 项浏览器流程通过。独立数据库的实际 HTTP 发奖验证输出：`{"database":"PostgreSQL","ruleVersion":2,"awardedXp":15,"ledgerEntries":1,"replay":"DUPLICATE_EVENT","result":"PASS"}`。截图为本地 Mock 测试数据：[桌面](screenshots/xp-desktop.png)、[中文移动端](screenshots/xp-mobile.png)。

连接恢复验证：重启独立 PostgreSQL 后，同一 Node 进程收到脱敏的空闲连接错误提示，并在下一次查询自动重连，输出 `POOL_RECOVERY_PASS`。连接池设置 15 秒连接超时，不输出原始连接对象或凭证。
