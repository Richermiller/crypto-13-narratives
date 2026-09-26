# 牛市 13 大叙事主线 · 速查表（自动更新版）

一个自包含的加密行情速查页，涵盖 13 条叙事、50 个代币，并内置每个代币的操作建议 / 买卖点 / 长期持有评级 / 潜力判断。

- 在线地址：https://richermiller.github.io/crypto-13-narratives/
- 数据源：CoinGecko 公开 API（免费，无需 key）

## 自动更新机制

本仓库通过 **GitHub Actions 定时任务** 每 6 小时自动拉取一次最新行情并重建页面，全程在 GitHub 的服务器上运行，**不占用任何 AI / 模型额度**，也不需要你手动干预。

| 项目 | 说明 |
|---|---|
| 更新频率 | 每 6 小时一次（每天 4 次） |
| 触发时间 | 北京时间 00:00 / 06:00 / 12:00 / 18:00 |
| 运行位置 | GitHub Actions（免费） |
| 更新内容 | 价格、市值、FDV、流通量、总供应、最大供应、解锁比例、更新时间戳 |

### 手动立即刷新
进入仓库 → **Actions** → 左侧选「每6小时自动更新行情」→ **Run workflow** → 绿色按钮 Run workflow。

### 修改更新频率 / 时区
编辑 `.github/workflows/update.yml` 里的 `cron` 一行即可（UTC 时间）。例如改成每 3 小时：`0 */3 * * *`。

### 若不想用 GitHub，改自建服务器
`build.js` 是纯 Node 脚本（仅依赖 `node` + 联网），把它和 `data.json`、`template.html` 一起放到任意 Linux 服务器，再加一条 crontab 即可：

```cron
0 0,6,12,18 * * *  cd /path/to/repo && /usr/bin/node build.js && git add -A && git commit -m "auto update" && git push
```

## 目录结构
- `data.json` —— 数据源（静态字段：名称/机构/观察/操作建议 + 最近一次行情兜底值）
- `template.html` —— 页面模板（含占位符 `__TOKENS__` / `__ADVICE__` / `__UPDATED_AT__`）
- `build.js` —— 拉取 CoinGecko 行情，合并后重建 `index.html`
- `index.html` —— 生成的最终页面（由 GitHub Pages 直接托管）

## 免责声明
本页所有行情与建议均为公开信息整理，非投资建议；买卖点为技术参考位，不构成任何保证。
