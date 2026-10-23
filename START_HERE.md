# 先把后台用起来

当前交付为 V0.2 积分增量。无需 Discord Token 即可操作本地后台；真实 Discord 接入需要另行配置测试公会。本地 Mock 的操作不会发送真实消息。

## 在自己的电脑启动

1. 安装 Node.js 24 LTS（附带 npm）。
2. 解压源码包，进入包含 `package.json` 的项目根目录，在该目录打开终端。GitHub ZIP 解压后的目录通常叫 `codex-evomeme-v0.1`；独立源码包目录叫 `EvoMeme-v0.1`。
3. 执行：

   ```sh
   npm ci
   npm run dev
   ```

4. 保持终端运行，在自己电脑的浏览器打开终端输出的 `Local` 地址（控制台默认端口 5173）。云环境文件预览页无法代替这个后台。
5. 在右上角 **语言 / Language** 选择 **简体中文**（首次也会自动匹配浏览器语言）。点击身份为“超级管理员”的按钮进入模拟后台；英文按钮为 `Enter as SUPER ADMIN`。无需配置 `.env` 或 PostgreSQL。

本地模式只监听本机，不要用隧道将 Mock 登录公开到互联网。数据保存在 `.data/postgres`，关闭终端并重新启动后保留。运行时不要再启动第二个 API 或运行 `npm run db:migrate`。

## 更新已下载的 ZIP 版本

如果使用 Git clone，先切换到 `evomeme-v0.1` 分支，再在项目目录执行 `git pull --ff-only origin evomeme-v0.1`。如果使用 ZIP 下载，需重新下载该分支的最新 ZIP；旧目录不会自动收到 GitHub 更新。

先停止自己运行的后台，再更新源码。保留已有 `.env` 和 `.data`（包括此前使用的 `.data/local-3210`），不要删除或覆盖这些本地配置和数据。对于 ZIP，可先解压到单独目录，核对后仅合并源码文件。更新后运行 `npm ci`；开发模式用 `npm run dev`，构建版需要重新执行 `npm run build` 再用 `npm run api`。

如果此前使用 3210 端口，继续用同一 PowerShell 窗口中的配置启动；新窗口可重新设置：

```powershell
$env:APP_MODE = "mock"
$env:HOST = "127.0.0.1"
$env:PORT = "3210"
$env:PUBLIC_ORIGIN = "http://127.0.0.1:3210"
$env:DATA_DIR = ".data/local-3210"
npm run api
```

启动后保持终端运行，浏览器强制刷新即可看到语言切换。语言选择只改变管理界面，不会自动翻译已保存的文案。

## 五分钟操作路径

1. **Mimo 与灵感机**（Mimo & Ideas）→ **给我点惊喜！** → **生成游戏提示词**：查看可复制的游戏提示词。
2. 同页点击 **创建模拟工单**；进入 **工单**（Tickets）点击编号，填写理由并更新状态。
3. **设置**（Settings）→“已批准的发布频道 ID”输入 `123456789012345678`。这是仅供本地 Mock 使用的测试 ID，不是真实频道。保存草稿。
4. **运营阶段**（Lifecycle）检查并发布该草稿；勾选 **消息发布**（messaging），保存并发布新草稿。
5. **消息中心**（Messaging）填相同测试 ID 和消息，保存草稿、确认投递、刷新查看 **已发送**（SENT）。这是 Mock 回执，不会投递 Discord。

## 下一步接入真实 Discord

按照 [部署手册](docs/DEPLOYMENT.md) 准备独立 PostgreSQL、测试 Guild、Bot Application、OAuth 回调和授权角色/频道 ID。凭证保存在本机 `.env` 或部署平台的秘密设置中，**不要在聊天发送 Token 或提交 Git**。

先以写入关闭的配置运行只读公会审计，核对权限；获得测试公会操作批准后再开启写入、注册命令并启动 Bot / Worker。当前没有配置这些凭证，真实 Gateway、OAuth 和私密频道仍需 sandbox 验收。

积分与 Boost 核查已加入，默认关闭；先阅读 [积分使用步骤](docs/XP.md)。舆情、DM 和重复排期尚未实现；完整范围见 [交付状态](docs/STATUS.md)。
