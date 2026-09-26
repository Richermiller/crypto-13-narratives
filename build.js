// build.js —— 拉取 CoinGecko 实时行情，重建 index.html（供 GitHub Actions 定时调用）
const fs = require('fs');
const https = require('https');

const DATA = JSON.parse(fs.readFileSync('data.json', 'utf8'));

function beijingNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' 北京时间';
}
function trim(x) {
  const s = (x >= 100 ? x.toFixed(1) : x.toFixed(2));
  return s.replace(/\.?0+$/, '');
}
function fmtSupply(n) {
  if (n == null || isNaN(n)) return null;
  if (n >= 1e12) return trim(n / 1e12) + 'T';
  if (n >= 1e9) return trim(n / 1e9) + 'B';
  if (n >= 1e6) return trim(n / 1e6) + 'M';
  if (n >= 1e3) return trim(n / 1e3) + 'K';
  return String(Math.round(n));
}
function fetchMarkets(ids) {
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' +
    ids.join(',') + '&order=market_cap_desc&per_page=100&sparkline=false';
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'crypto-dashboard/1.0', 'Accept': 'application/json' }, timeout: 60000 }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async function main() {
  const coins = DATA.coins;
  const ids = coins.filter(c => c.cg).map(c => c.cg);
  let live = [];
  let srcErr = null;
  try { live = await fetchMarkets(ids); } catch (e) { srcErr = e.message; }
  const byId = {};
  live.forEach(c => byId[c.id] = c);

  let liveCount = 0;
  coins.forEach(c => {
    const d = c.cg ? byId[c.cg] : null;
    if (d && d.current_price != null) {
      liveCount++;
      c.p = d.current_price;
      c.mc = d.market_cap != null ? d.market_cap : c.mc;
      c.fdv = d.fully_diluted_valuation != null ? d.fully_diluted_valuation : c.fdv;
      if (d.circulating_supply != null) c.circ = fmtSupply(d.circulating_supply);
      if (d.total_supply != null) c.total = fmtSupply(d.total_supply);
      if (d.max_supply != null) c.max = fmtSupply(d.max_supply);
      if (d.max_supply != null && d.circulating_supply != null && d.max_supply > 0) {
        const pct = Math.round(d.circulating_supply / d.max_supply * 100);
        c.unlocked = '约' + pct + '%已解锁（' + fmtSupply(d.circulating_supply) + '/' + fmtSupply(d.max_supply) + '）';
      }
    }
  });

  // 回写 data.json，保证兜底数据始终为最近一次成功值
  fs.writeFileSync('data.json', JSON.stringify(DATA, null, 1));

  const TOKENS = coins.map(c => ({
    s: c.s, n: c.n,
    p: c.p ?? null, mc: c.mc ?? null, fdv: c.fdv ?? null,
    circ: c.circ || null, total: c.total || null, max: c.max || null,
    unlocked: c.unlocked || null, inst: c.inst || null,
    note: (c.obs || '') + (c.cg ? '' : '｜未接入实时源(手动快照)')
  }));

  let tpl = fs.readFileSync('template.html', 'utf8');
  const stamp = beijingNow() + (srcErr ? ' · 数据源暂不可用(展示上次数据)' : '');
  tpl = tpl.replace('__TOKENS__', JSON.stringify(TOKENS));
  tpl = tpl.replace('__ADVICE__', JSON.stringify(DATA.advice));
  tpl = tpl.replace('__UPDATED_AT__', stamp);
  fs.writeFileSync('index.html', tpl);

  console.log('live:', liveCount, '/', coins.length, '| 数据源错误:', srcErr || '无', '| 时间戳:', stamp);
})();
