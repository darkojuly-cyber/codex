# 本机后台通过 Cloudflare 临时隧道分享

适用于已经能用 Start.cmd 启动的 Windows 项目。使用 Cloudflare Quick Tunnel，不需要先购买域名或注册 Cloudflare 账号。该入口是临时试用地址，没有固定网址或持续可用保证；电脑、网络、隧道与项目服务必须保持运行。

## 第一次操作

1. 双击 `Stop.cmd`，只停止本项目。下载并复制新版项目文件到正确根目录，保留 `.env.local`、`.env` 和 `.data`。不需要重新安装依赖、注册 Discord 指令或重启电脑。
2. 双击 `StartTunnel.cmd`。首次缺少 cloudflared 时，会从 Cloudflare 官方 GitHub Release 下载 Windows x64 程序到 `%LOCALAPPDATA%\EvoMemeTools\cloudflared.exe`；不会使用管理员权限安装到系统目录。如果已有 PATH 中的 cloudflared，则使用已有程序。脚本从当前项目配置读取 PORT，默认只转发 `http://127.0.0.1:3210`。
3. 等待窗口出现 `https://若干单词.trycloudflare.com`。只复制 HTTPS 网址这一段，不要复制整行日志。保留这个窗口，持续输出日志属于正常运行。
4. 双击 `StartPublic.cmd`，粘贴该网址并按回车。它会打印本次唯一需要的完整 Discord 回调地址：`https://本次地址.trycloudflare.com/api/auth/callback`。
5. 在 Discord Developer Portal 选择 **与本项目 DISCORD_CLIENT_ID 一致的应用**，进入 OAuth2 → Redirects，添加启动窗口打印的完整回调并保存。保留已有 `https://localhost:8443/api/auth/callback`，不用删除。不要粘贴网址示例，要使用本次实际生成的地址。
6. 回到 StartPublic 窗口，按回车继续。它会自动构建变化的源码，启动 API/Caddy/Bot/Worker，检查公网隧道是否确实到达当前项目，再打开公网后台。
7. 把公网网址分享给工作人员。对方通过 Discord 登录，必须是当前服务器成员且具有后台授权；超级管理员可在设置 → 工作人员授权中分配权限。拿到网址不等于拥有管理权限。

两个窗口可以最小化，但不要关闭。外网模式下本机也使用公网网址登录和操作，不要混用 localhost，否则登录 state 或 POST 来源校验可能不匹配。远程工作人员无需安装本机 Caddy 根证书。

## 不用改什么

- 不修改 `.env.local` 或 `.env`：本次公网 PUBLIC_ORIGIN 和 DISCORD_REDIRECT_URI 只注入此次启动的子进程，文件中的本地配置保留。
- Caddy 仍使用本机 HTTPS 地址，API 始终绑定 127.0.0.1；不用开放路由器端口。
- 不将 Token、数据库 URL、Client Secret 发送给同事、粘贴到网页或提交 GitHub。
- 不会新建第二个 Bot/Worker；若另一模式仍在运行，先用 Stop.cmd 停止。端口被其他项目占用时不会擅自杀掉其他进程。

## 停止和恢复

停止项目：双击 `Stop.cmd`。停止公网隧道：在 StartTunnel 窗口按 Ctrl+C，或关闭该窗口。Stop.cmd 不会查杀电脑上其他 cloudflared 进程，也不会关闭独立的隧道窗口。

恢复本地使用：停止公网项目和隧道后，双击原来的 `Start.cmd` 或 Mimo 快捷方式，继续使用 `https://localhost:8443`，无需改回环境文件。

重建临时隧道后网址可能变化，需重新执行上面的第 3–6 步，并添加对应 Discord 回调。新主机名不共享旧 Cookie，因此需要重新登录。不同试用地址不适合作为长期固定入口；固定域名/正式托管应另行配置。

## 常见问题

- **隧道显示 502**：项目还没启动时是正常现象；先完成回调注册，再启动 StartPublic。项目就绪后还 502，检查隧道是否仍转发当前项目 PORT。
- **Invalid redirect_uri**：必须在同一个 Discord 应用中添加启动窗口打印的完整地址，包含 HTTPS、当前临时主机名及 `/api/auth/callback`，保存后从公网首页重新点击登录。
- **另一会话已运行**：先 Stop.cmd，再启动所选模式；不要重复打开旧 Bot/Worker PowerShell 窗口。
- **公开地址检查失败**：检查 StartTunnel 窗口还在运行、粘贴的是当前地址、网络能连接 Cloudflare。不能通过关闭 TLS 校验来绕过错误。
- **下载失败**：需要能访问官方 GitHub Releases。脚本只下载到用户工具目录，不修改其他程序；也可自行安装官方 cloudflared 后再运行。不要使用未知来源安装包。
- **已有 cloudflared 配置导致 Quick Tunnel 报错**：不要删除或覆盖其他隧道的配置，保留错误日志再排查。

验证边界：云端验证了启动配置隔离、地址校验、现有授权/CSRF 行为及构建；官方 Windows x64 下载地址返回 HTTP 200。当前云环境没有替用户实际运行 Windows PowerShell、Caddy、Cloudflare 隧道或真实 Discord OAuth，首次连接仍需按上面步骤在本机验收。
