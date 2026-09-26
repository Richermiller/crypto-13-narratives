// amp.js —— 计算「日线振幅拐点」
// 数据源优先级：Binance 日K → MEXC 日K → CoinGecko 4小时K聚合日线
// 日振幅 = (最高-最低)/前收盘；20日均振幅；比值 = 当日振幅/20日均振幅
// 状态：比值>=2.0 脉冲 / <=0.6 压缩 / 其余常态
// 拐点 = 振幅曲线局部转折：压缩底(蓄势变盘) / 脉冲顶(退潮见顶)
const fs = require('fs');
const https = require('https');

const DATA = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const CACHE_FILE = 'amp.json';
const CACHE_MS = 20 * 3600 * 1000;

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

async function fetchExchangeDaily(sym) {
  const bases = [
    ['binance', 'https://api.binance.com/api/v3/klines?symbol={S}USDT&interval=1d&limit=90'],
    ['mexc', 'https://api.mexc.com/api/v3/klines?symbol={S}USDT&interval=1d&limit=90']
  ];
  for (const [name, b] of bases) {
    for (let a = 0; a < 2; a++) {
      try {
        const j = await fetchJSON(b.replace('{S}', sym));
        if (Array.isArray(j) && j.length >= 25) {
          const daily = j.map(k => ({ date: new Date(k[0]).toISOString().slice(0, 10), o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
          return { daily, src: name };
        }
      } catch (e) { /* retry */ }
      await sleep(500);
    }
  }
  return null;
}

async function fetchCg4hDaily(id) {
  for (let a = 0; a < 3; a++) {
    try {
      const j = await fetchJSON('https://api.coingecko.com/api/v3/coins/' + id + '/ohlc?vs_currency=usd&days=30');
      if (Array.isArray(j)) {
        const days = {};
        for (const [t, o, h, l, c] of j) {
          const date = new Date(t).toISOString().slice(0, 10);
          if (!days[date]) days[date] = { date, o, h, l, c };
          else { days[date].h = Math.max(days[date].h, h); days[date].l = Math.min(days[date].l, l); days[date].c = c; }
        }
        return { daily: Object.values(days), src: 'coingecko' };
      }
    } catch (e) { /* retry */ }
    await sleep(2500); // CoinGecko 限流保护
  }
  return null;
}

function analyze(daily) {
  if (!daily || daily.length < 25) return null;
  const pts = [];
  for (let i = 1; i < daily.length; i++) {
    const d = daily[i], pc = daily[i - 1].c;
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

(async function main() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      const age = Date.now() - (cached.updatedAt || 0);
      const haveAll = DATA.coins.filter(c => c.cg).every(c => cached.coins[c.s]);
      if (age < CACHE_MS && haveAll) {
        console.log('amp.json 缓存新鲜，跳过拉取（age=' + Math.round(age / 3600000) + 'h）');
        return;
      }
    } catch (e) { /* 重新拉取 */ }
  }

  const coins = DATA.coins.filter(c => c.s !== 'BEEZIE');
  const result = { updatedAt: Date.now(), coins: {} };
  const stat = {};
  let fail = 0;
  for (let i = 0; i < coins.length; i++) {
    const c = coins[i];
    let r = await fetchExchangeDaily(c.s);
    if (!r && c.cg) r = await fetchCg4hDaily(c.cg);
    if (r) {
      const a = analyze(r.daily);
      if (a) { a.src = r.src; result.coins[c.s] = a; stat[r.src] = (stat[r.src] || 0) + 1; continue; }
    }
    fail++; console.log('  无数据:', c.s);
    if ((i + 1) % 10 === 0) console.log('进度', i + 1, '/', coins.length, JSON.stringify(stat), 'fail', fail);
    await sleep(400);
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(result));
  console.log('amp.js 完成 | 来源统计:', JSON.stringify(stat), '| 无数据:', fail);
})();
