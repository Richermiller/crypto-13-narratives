#!/bin/bash
# crypto-13-narratives 本地自动更新：每小时刷新「振幅拐点 + 行情 + ETF」，提交推送到 GitHub
# 由 LaunchAgent com.bc-richard.crypto-narratives-update 触发（StartInterval 3600s）
# 为什么放本机跑而不是 GitHub Actions：GitHub Actions 跑在美国 IP，Binance/MEXC 被地理封锁、CoinGecko 403，
#   导致后台从没真正刷到过拐点数据。本机（墙内+代理）三个数据源都可直达。
set -uo pipefail
cd "$(dirname "$0")" || exit 1
NODE=/usr/local/bin/node

# 防并发：上次运行还没结束（<90 分钟）则跳过本次
LOCK=/tmp/crypto-narratives-update.lock
if [ -f "$LOCK" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$LOCK") ))
  if [ "$AGE" -lt 5400 ]; then
    echo "[$(date '+%F %T')] 上次更新仍在运行（锁年龄 ${AGE}s），跳过本次"
    exit 0
  fi
fi
touch "$LOCK"
trap 'rm -f "$LOCK"' EXIT

echo "===== [$(date '+%F %T')] 开始自动更新 ====="

# 同步远程（--autostash 兜底处理本地未提交改动，失败不阻塞）
git pull --rebase --autostash origin main 2>&1 | tail -3 || true

# 1. 振幅拐点（小时级每 1h 刷新 / 日线级每天北京 10:00 刷新，内部带缓存）
"$NODE" amp.js 2>&1 | tail -2 || true

# 2. 行情 + 重建 narrative.html（CoinGecko 403 时 Binance 兜底）
"$NODE" build.js 2>&1 | tail -2 || true

# 3. ETF 资金流
"$NODE" etf.js 2>&1 | tail -2 || true

# 提交并推送（有数据变化才提交）
git add data.json narrative.html amp.json etf.json 2>&1
if git diff --cached --quiet; then
  echo "数据无变化，跳过提交"
else
  git commit -m "auto: 行情数据更新 $(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M')" 2>&1 | tail -2
  git push origin main 2>&1 | tail -3
fi

echo "===== [$(date '+%F %T')] 完成 ====="
