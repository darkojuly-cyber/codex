# Windows 一键启动

适用于本机已经完成 Discord、Neon 和 Caddy 配置的 EvoMeme。以后每次重启电脑，不用逐个打开 PowerShell 输入启动命令。

## 三个入口

在 **与 package.json 同一层** 的项目文件夹里：

| 文件 | 用途 |
| --- | --- |
| `Start.cmd` | 启动一个控制窗口，检查/构建前端，启动 API、Caddy、Bot 和 Worker，就绪后打开浏览器 |
| `Stop.cmd` | 停止这一键会话自己启动的服务，等待退出；不结束其他 Node 项目或手动复用的服务 |
| `Status.cmd` | 查看各服务状态和是否由当前会话管理 |

控制窗口统一显示 `[API]`、`[Caddy]`、`[Bot]`、`[Worker]`，可以最小化。关闭服务优先双击 `Stop.cmd`。

## 第一次使用

1. 更新源码到原来的项目根目录。保留 `.env.local`、`.env`、`.neon`、`.data` 和已有 Caddy 安装。
2. 第一次切换到一键启动时，先在旧 API、Bot、Worker、Caddy 窗口各按一次 `Ctrl+C`。这只是首次迁移，之后使用 Start/Stop 即可。
3. 项目依赖已经安装时直接双击 `Start.cmd`。缺依赖时先在项目根目录运行一次 `npm ci`。
4. 首次启动或源码改变时自动执行 TypeScript 检查和 Vite 构建；失败会保留错误窗口并停止启动。
5. 等出现 `READY - https://localhost:8443`，浏览器会自动打开。原来配置的回调地址不变。

桌面使用时创建 **Start.cmd 的快捷方式**，快捷方式可以放在桌面；启动文件本体和 scripts 文件夹仍保留在项目目录。

## 保存原来临时输入的开关

在 PowerShell 中设置的 `$env:...` 不会跨电脑重启保存。想持续使用的设置应写入 `.env.local`（已有同名项就修改），例如：

```dotenv
APP_MODE=discord
HOST=127.0.0.1
PORT=3210
PUBLIC_ORIGIN=https://localhost:8443
DISCORD_REDIRECT_URI=https://localhost:8443/api/auth/callback
GUILD_MEMBERS_INTENT=true
MESSAGE_CONTENT_INTENT=false
```

`GUILD_MEMBERS_INTENT=true` 需要先在 Discord Developer Portal 开启 **Server Members Intent**。需要自动聊天计分时再开启 Portal 的 **Message Content Intent**，并将对应文件设置改为 `true`。启动器沿用已保存的 Intent 设置，不替你打开这些特权开关。

这是完整 Discord 服务启动入口：与此前授权的手动流程一致，API 进程使用 `DISCORD_WRITES_ENABLED=false`，Bot/Worker 使用 `true`。实际欢迎、计分、工单和计划发送仍受原有已发布配置控制。启动器不注册 Slash 指令、不发布规则，也不改已有积分。临时只开后台可继续使用 `npm run api`。

## Caddy 与 HTTPS

默认复用之前安装的：

```text
%LOCALAPPDATA%\EvoMemeTools\caddy.exe
%APPDATA%\Caddy\pki\authorities\local\root.crt
```

启动器在 `.data/launcher/Caddyfile` 生成自己的本机配置，仅绑定回环地址，不覆盖原来的 Caddyfile，不占用额外的 HTTP 80 或管理 2019 端口。已有兼容的 Caddy/新版 API 会在真实健康检查通过后复用，停止时不关闭这些手动服务。

HTTPS 检查使用已有 Caddy 根证书验证服务器，不关闭 TLS 校验。Caddy 首次生成本地 CA 时，Windows 可能要求确认安装本地根证书；已安装的环境通常不需要重复确认。

有自定义路径时，在 `.env.local` 中选填：

```dotenv
EVOMEME_CADDY_EXE=D:/Tools/caddy.exe
EVOMEME_CADDYFILE=D:/Config/Caddyfile
EVOMEME_CADDY_ROOT_CERT=D:/Config/root.crt
```

没有自定义配置就不要添加这些值。自定义 Caddyfile 必须将 `PUBLIC_ORIGIN` 对应的 HTTPS 地址代理到 `127.0.0.1:PORT`。

## 重复启动、重启和停止

- 已有一键会话时再次双击 Start，只显示状态并在就绪时打开浏览器，不启动第二套服务。
- 同一项目的旧手动 Bot/Worker 还在运行时会停止本次启动并提示先关旧窗口，不创建重复 Gateway/Worker。
- API 端口被其他项目或旧版不可验证 API 占用时会停止，不抢占端口、不结束该进程。
- 旧会话的状态文件可在确认进程已退出、系统已重启或 PID 已被其他进程复用后恢复；不会据一个旧 PID 强行结束进程。
- Node 服务由直接进程运行，通过私有本机控制和 IPC 请求退出；停止不会全局执行 `taskkill node.exe`。
- 控制进程异常断开时，Node 服务收到 IPC 断开会请求退出。机器强行断电等情况仍遵循原有队列的 UNKNOWN/不盲重发策略。

## 登录 Windows 后自动启动（可选）

1. 按 `Win+R`，输入 `shell:startup` 并回车。
2. 将 Start.cmd 的 **快捷方式** 放入这个启动文件夹。
3. 下次登录会按同一套配置启动；仍需等待网络、Neon 和 Discord 可用。

以后更新源码时先双击 Stop.cmd，合并新源码后再双击 Start.cmd；重复点击 Start 是复用已有会话，不是强制重启。

需要取消时只移除该快捷方式。没有安装 Windows 系统服务、修改系统执行策略或要求每次以管理员运行。

## 排错和验证范围

日志保存在 `.data/launcher/logs/`，有组件名和时间。已知 Discord Token、Client Secret、数据库 URL 和密码会过滤，单日志超过约 5 MiB 时保留一份上一轮日志。不要分享 `.env.local` 或 `.data/launcher/owner.json`（其中包含本机控制令牌）。

看到失败时，把控制窗口最后几行输出发来。不要删除数据库目录或 PGlite 锁。

云环境完成了类型/构建检查、状态互斥、认证、重启/PID 复用恢复、路径识别、日志过滤、源码构建指纹，以及真实 API 的隔离数据库启动与 IPC 退出测试。云主机为 Linux，未实际执行 Windows CMD、PowerShell CIM、Windows 证书安装或真实 Discord 联动。首次 Windows 双击启动仍需本机验收。云开发环境继续使用既有 npm 开发命令，不运行 Windows 启动器。

本轮结果：lint、TypeScript/Vite 构建、78 项本地测试及 8 项浏览器流程通过；其中真实 API 子进程在隔离 PGlite 数据库中启动并经 IPC 正常关闭、释放数据库锁。Windows 专属入口与 Caddy/Discord 联动尚未在 Windows 主机执行。
