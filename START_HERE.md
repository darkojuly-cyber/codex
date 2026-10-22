# 先把后台用起来

当前交付为 V0.1。无需 Discord Token 即可操作本地后台；真实 Discord 接入需要另行配置测试公会。本地 Mock 的操作不会发送真实消息。

## 在自己的电脑启动

1. 安装 Node.js 24 LTS（附带 npm）。
2. 解压源码包，进入 `EvoMeme-v0.1` 文件夹，在该文件夹打开终端。
3. 执行：

   ```sh
   npm ci
   npm run dev
   ```

4. 保持终端运行，在自己电脑的浏览器打开终端输出的 `Local` 地址（控制台默认端口 5173）。云环境文件预览页无法代替这个后台。
5. 选择 `Enter as SUPER ADMIN` 进入明确标注 MOCK 的控制台。无需配置 `.env` 或 PostgreSQL。

本地模式只监听本机，不要用隧道将 Mock 登录公开到互联网。数据保存在 `.data/postgres`，关闭终端并重新启动后保留。运行时不要再启动第二个 API 或运行 `npm run db:migrate`。

## 五分钟操作路径

1. **Mimo & Ideas** → **Surprise me!** → **Generate game prompt**：查看可复制的游戏提示词。
2. 同页点击 **Create mock ticket**；进入 **Tickets** 点击编号，填写理由并更新状态。
3. **Settings** → Approved publishing channel IDs 输入 `123456789012345678`。这是仅供本地 Mock 使用的测试 ID，不是真实频道。保存草稿。
4. **Lifecycle** 检查并发布该草稿；勾选 `messaging`，保存并发布新草稿。
5. **Messaging** 填相同测试 ID 和消息，保存草稿、确认投递、刷新查看 `SENT`。这是 Mock 回执，不会投递 Discord。

## 下一步接入真实 Discord

按照 [部署手册](docs/DEPLOYMENT.md) 准备独立 PostgreSQL、测试 Guild、Bot Application、OAuth 回调和授权角色/频道 ID。凭证保存在本机 `.env` 或部署平台的秘密设置中，**不要在聊天发送 Token 或提交 Git**。

先以写入关闭的配置运行只读公会审计，核对权限；获得测试公会操作批准后再开启写入、注册命令并启动 Bot / Worker。当前没有配置这些凭证，真实 Gateway、OAuth 和私密频道仍需 sandbox 验收。

XP、Boost、舆情、DM 和重复排期尚未实现；完整范围见 [交付状态](docs/STATUS.md)。
