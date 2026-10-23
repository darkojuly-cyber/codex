# 欢迎卡片文案

自动欢迎和 `/welcome` 补看共用 Discord Embed 外观。预览见
[welcome-card-preview.png](screenshots/welcome-card-preview.png)，实际排版由 Discord 客户端决定。

新建数据库默认采用下面的欢迎语。已有数据库不会被源码更新自动覆盖：
在后台 **Mimo 与灵感 → 人设 → 欢迎模板** 粘贴下面的文字，保留 `{user}`，
点击 **保存配置草稿**，再到 **生命周期** 检查并发布对应草稿。
发布后，新欢迎消息使用新文案，已发送的消息不会被自动修改。

```text
Hey {user}, glad you found us 👾

Got a weird idea? You’ll fit right in.
Make a game, remix something unexpected, or just hang out and see what everyone’s cooking.

No idea where to start? Let Mimo surprise you. 🎲
```

卡片下方三个短引导为：

- **Surprise Me!** — Start with a little chaos.
- **Explore EvoMeme** — See what you can make.
- **Get Support** — We’re here if you get stuck.

页脚：**Anything can be a game.**

此更新只修改文案，不启用自动欢迎，也不自动发布已有配置。
