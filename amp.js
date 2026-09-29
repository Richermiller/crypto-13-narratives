// amp.js —— 计算「振幅拐点」（日线级 + 小时级）
// 数据源优先级：Binance → MEXC（日K/小时K）→ CoinGecko（仅日线 fallback）
// 日振幅 = (最高-最低)/前收盘；20 周期均振幅；比值 = 当期振幅/20 周期均振幅
// 状态：比值>=2.0 脉冲 / <=0.6 压缩 / 其余常态
// 拐点 = 振幅曲线局部转折：压缩底(蓄势变盘) / 脉冲顶(退潮见顶)
// 分级缓存：日线每天北京时间 10:00 刷新；小时线每小时刷新
// 首次判定时间持久化：拐点(date+type)未变则沿用旧时间戳，变化才更新
const fs = require('fs');
const https = require('https');

const DATA = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const CACHE_FILE = 'amp.json';
const DAILY_MS = 24 * 3600 * 1000;   // 日线缓存 24h（每天 10 点刷新）
const HOURLY_MS = 1 * 3600 * 1000;   // 小时线缓存 1h

function fetchJSON(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 通用 K 线抓取（Binance/MEXC），dateSlice：10=日线 16=小时线(到分钟)
async function fetchKlines(sym, interval, limit, dateSlice) {
  const bases = [
    ['mexc', `https://api.mexc.com/api/v3/klines?symbol=${sym}USDT&interval=${interval}&limit=${limit}`],
    ['binance', `https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${interval}&limit=${limit}`]
  ];
  for (const [name, b] of bases) {
    for (let a = 0; a < 2; a++) {
      try {
        const j = await fetchJSON(b);
        if (Array.isArray(j) && j.length >= 20) {
          const bars = j.map(k => ({ date: new Date(k[0]).toISOString().slice(0, dateSlice), o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
          return { bars, src: name };
        }
      } catch (e) { /* retry */ }
      await sleep(400);
    }
  }
  return null;
}

// CoinGecko 4h→日线聚合（日线 fallback）
async function fetchCgDaily(cg) {
  for (let a = 0; a < 3; a++) {
    try {
      const j = await fetchJSON('https://api.coingecko.com/api/v3/coins/' + cg + '/ohlc?vs_currency=usd&days=30');
      if (Array.isArray(j)) {
        const days = {};
        for (const [t, o, h, l, c] of j) {
          const date = new Date(t).toISOString().slice(0, 10);
          if (!days[date]) days[date] = { date, o, h, l, c };
          else { days[date].h = Math.max(days[date].h, h); days[date].l = Math.min(days[date].l, l); days[date].c = c; }
        }
        return { bars: Object.values(days), src: 'coingecko' };
      }
    } catch (e) { /* retry */ }
    await sleep(2500);
  }
  return null;
}

// 振幅拐点分析（日线/小时线通用，窗口=20周期）
function analyze(bars) {
  if (!bars || bars.length < 25) return null;
  const pts = [];
  for (let i = 1; i < bars.length; i++) {
    const d = bars[i], pc = bars[i - 1].c;
    if (!pc) continue;
    pts.push({ date: d.date, c: d.c, amp: (d.h - d.l) / pc });
  }
  if (pts.length < 22) return null;
  const W = 20;
  for (let i = 0; i < pts.length; i++) {
    const lo = Math.max(0, i - W + 1);
    let s = 0; for (let k = lo; k <= i; k++) s += pts[k].amp;
    pts[i].ma = s / (i - lo + 1);
    pts[i].ratio = pts[i].ma > 0 ? pts[i].amp / pts[i].ma : 1;
  }
  const last = pts[pts.length - 1];
  const prevC = pts.length > 1 ? pts[pts.length - 2].c : last.c;
  const dir = last.c >= prevC ? 'up' : 'down';
  let state = '常态', signal = '常态·无明确拐点';
  if (last.ratio >= 2.0) { state = '脉冲'; signal = dir === 'up' ? '波动脉冲·加速/突破' : '波动脉冲·见顶风险'; }
  else if (last.ratio <= 0.6) { state = '压缩'; signal = '压缩蓄势·波动收窄，关注变盘'; }

  const start = Math.max(1, pts.length - 30);
  let lastMin = -1, lastMax = -1;
  for (let i = start; i < pts.length - 1; i++) {
    if (pts[i].amp < pts[i - 1].amp && pts[i].amp < pts[i + 1].amp && pts[i].ratio < 0.9) lastMin = i;
    if (pts[i].amp > pts[i - 1].amp && pts[i].amp > pts[i + 1].amp && pts[i].ratio > 1.4) lastMax = i;
  }
  let lastTurn = null;
  if (lastMin >= 0 || lastMax >= 0) {
    const pick = lastMax >= lastMin ? lastMax : lastMin;
    lastTurn = pick === lastMax
      ? { i: pick, type: '脉冲拐点·退潮/见顶', dir: 'risk' }
      : { i: pick, type: '压缩拐点·变盘蓄势', dir: 'watch' };
  }
  const SPAN = 60;
  const series = pts.slice(-SPAN).map(p => +((p.amp * 100).toFixed(3)));
  const turnIdx = lastTurn ? (lastTurn.i - (pts.length - series.length)) : -1;
  return {
    state, ratio: +last.ratio.toFixed(2),
    ampPct: +(last.amp * 100).toFixed(2), ma20Pct: +(last.ma * 100).toFixed(2),
    dir, signal,
    lastTurn: lastTurn ? { date: pts[lastTurn.i].date, type: lastTurn.type, dir: lastTurn.dir } : null,
    turnIdx: turnIdx >= 0 && turnIdx < series.length ? turnIdx : null,
    series
  };
}

// 首次判定时间持久化：拐点(date+type)未变则沿用旧 detectedAt，变化才更新
function persistDetectedAt(cur, prev, now) {
  if (!cur) return null;
  cur.detectedAt = (prev && prev.type === cur.type && prev.date === cur.date && prev.detectedAt) ? prev.detectedAt : now;
  return cur;
}

function isBeijingTen() {
  return new Date(Date.now() + 8 * 3600 * 1000).getUTCHours() === 10;
}

(async function main() {
  let cached = { coins: {}, dailyUpdatedAt: 0, hourlyUpdatedAt: 0 };
  try { const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); if (c.coins) cached.coins = c.coins; cached.dailyUpdatedAt = c.dailyUpdatedAt || 0; cached.hourlyUpdatedAt = c.hourlyUpdatedAt || 0; } catch (e) {}

  const now = Date.now();
  const dailyAge = now - (cached.dailyUpdatedAt || 0);
  const hourlyAge = now - (cached.hourlyUpdatedAt || 0);
  // 日线：每天北京时间 10 点刷新（首跑或超 2 天未更新则兜底）
  const needDaily = dailyAge >= DAILY_MS && (isBeijingTen() || !cached.dailyUpdatedAt || dailyAge >= 2 * DAILY_MS);
  const needHourly = hourlyAge >= HOURLY_MS;

  const result = { updatedAt: now, dailyUpdatedAt: cached.dailyUpdatedAt || 0, hourlyUpdatedAt: cached.hourlyUpdatedAt || 0, coins: cached.coins };
  const coins = DATA.coins.filter(c => c.s !== 'BEEZIE');
  let stat = { daily: 0, hourly: 0 };

  if (needDaily || needHourly) {
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      const coin = result.coins[c.s] || {};

      if (needDaily) {
        let r = await fetchKlines(c.s, '1d', 90, 10);
        if (!r && c.cg) r = await fetchCgDaily(c.cg);
        if (r) {
          const a = analyze(r.bars);
          if (a) { a.src = r.src; a.lastTurn = persistDetectedAt(a.lastTurn, coin.lastTurn, now); Object.assign(coin, a); stat.daily++; }
        }
      }

      if (needHourly) {
        const r = await fetchKlines(c.s, '1h', 72, 16);
        if (r) {
          const a = analyze(r.bars);
          if (a) {
            Object.assign(coin, {
              hState: a.state, hRatio: a.ratio, hAmpPct: a.ampPct, hMa20Pct: a.ma20Pct, hDir: a.dir, hSignal: a.signal,
              hLastTurn: persistDetectedAt(a.lastTurn, coin.hLastTurn, now),
              hTurnIdx: a.turnIdx, hSeries: a.series, hSrc: r.src
            });
            stat.hourly++;
          }
        }
      }

      result.coins[c.s] = coin;
      if ((i + 1) % 20 === 0) console.log('进度', i + 1, '/', coins.length, JSON.stringify(stat));
      await sleep(300);
    }
  }

  if (needDaily) result.dailyUpdatedAt = now;
  if (needHourly) result.hourlyUpdatedAt = now;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(result));
  console.log('amp.js 完成 | 日线', stat.daily, '| 小时线', stat.hourly, '| 刷新:', needDaily ? '日线' : '', needHourly ? '小时线' : '');
})();
