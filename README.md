# 牛市叙事主线 · 全市场速查表（自动更新版）

一个自包含的加密行情速查页，以 13 大叙事主线为核心，覆盖 **币安现货全部加密代币（约 416 个，剔除稳定币与股票代币）**，并内置：
- 每个代币的**操作建议 / 买卖点 / 长期持有评级 / 潜力判断**（核心币手写精修，长尾币规则分级）；
- 全量明细表：**点击表头升降序排序 + 搜索按钮 + 每屏 15 行可滚动**；
- **日线振幅拐点**（波动率择时）：基于日线 OHLC 计算振幅压缩/脉冲与拐点信号。

- 在线地址：https://richermiller.github.io/crypto-13-narratives/
- 行情数据源：CoinGecko 公开 API（免费，无需 key，按 id 分批拉取）
- 覆盖范围：Binance 现货 USDT 交易对（TRADING 状态），剔除稳定币与股票代币
- 日线数据源：MEXC → Binance → CoinGecko（多级 fallback，自动容错）

## 自动更新机制

本仓库通过 **GitHub Actions 定时任务** 每小时自动拉取一次最新行情并重建页面，全程在 GitHub 的服务器上运行，**不占用任何 AI / 模型额度**，也不需要你手动干预。

| 项目 | 说明 |
|---|---|
| 更新频率 | 每 1 小时一次（每天 24 次） |
| 触发时间 | 每小时整点（UTC 分钟 0，北京时间每小时 0 分） |
| 运行位置 | GitHub Actions（免费） |
| 更新内容 | 价格、市值、FDV、流通量、总供应、最大供应、解锁比例、日线振幅拐点、更新时间戳 |

### 手动立即刷新
进入仓库 → **Actions** → 左侧选「每小时自动更新行情」→ **Run workflow** → 绿色按钮 Run workflow。

### 修改更新频率 / 时区
编辑 `.github/workflows/update.yml` 里的 `cron` 一行即可（UTC 时间）。例如改成每 3 小时：`0 */3 * * *`。

### 若不想用 GitHub，改自建服务器
`build.js`、`amp.js` 是纯 Node 脚本（仅依赖 `node` + 联网），把它们和 `data.json`、`template.html` 一起放到任意 Linux 服务器，再加一条 crontab 即可：

```cron
0 * * * *  cd /path/to/repo && /usr/bin/node amp.js && /usr/bin/node build.js && git add -A && git commit -m "auto update" && git push
```

## 目录结构
- `data.json` —— 数据源（静态字段：名称/机构/观察/操作建议 + 最近一次行情兜底值）
- `template.html` —— 页面模板（含占位符 `__TOKENS__` / `__ADVICE__` / `__AMP__` / `__UPDATED_AT__`）
- `build.js` —— 拉取 CoinGecko 行情，合并后重建 `index.html`
- `amp.js` —— 拉取日线 OHLC（MEXC/Binance/CoinGecko），计算振幅拐点，缓存到 `amp.json`
- `amp.json` —— 振幅数据缓存（20 小时内复用，日线每天更新一次即可）
- `index.html` —— 生成的最终页面（由 GitHub Pages 直接托管）

## 振幅拐点算法说明
- 日振幅 =（最高-最低）/ 前收盘；20 日均振幅；比值 = 当日振幅 ÷ 20 日均振幅。
- 比值 ≤ 0.6 → **压缩蓄势**（波动收窄，关注变盘）；比值 ≥ 2.0 → **波动脉冲**（情绪放大，警惕见顶）。
- 拐点 = 振幅曲线局部转折：压缩底（蓄势变盘）/ 脉冲顶（退潮见顶）。

## 免责声明
本页所有行情与建议均为公开信息整理，非投资建议；买卖点为技术参考位，不构成任何保证。
