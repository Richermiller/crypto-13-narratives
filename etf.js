'use strict';
// ============================================================================
// ETF 资金流向 + 市场资金面 数据采集（GitHub Actions 定时运行）
// 输出 etf.json，供 etf.html 渲染。
//
// 数据源（全部免 key / 免费）：
//   · alternative.me  恐惧贪婪指数
//   · CoinGecko       稳定币市值 USDT+USDC
//   · Binance         资金费率 / 未平仓 OI / 24h涨跌 / 成交量（futures+spot）
//   · ETF 净流入      由 etf_flow.js 计算后合并（路A，见 etf_flow.js）
// ============================================================================
const fs = require('fs');

async function fetchJson(url, headers={}, tries=3){
  for(let i=0;i<tries;i++){
    try{
      const r = await fetch(url, {headers, signal: AbortSignal.timeout(20000)});
      if(!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){ if(i===tries-1) throw e; await new Promise(r=>setTimeout(r,800*(i+1))); }
  }
}

// 需要资金费率/持仓的币种
const FUTURES_COINS = ['BTC','ETH','SOL','XRP','DOGE','LTC'];

async function main(){
  let out = { updatedAt: new Date().toISOString(), coins: {}, mkt: {}, futures: {} };
  // 若已存在 etf.json（含路A算出的 coins），保留
  try { const old = JSON.parse(fs.readFileSync('etf.json','utf8')); out.coins = old.coins||{}; } catch(e){}

  // ① 恐惧贪婪指数
  try{
    const fg = await fetchJson('https://api.alternative.me/fng/?limit=1');
    if(fg && fg.data && fg.data[0]){ out.mkt.fgi=+fg.data[0].value; out.mkt.fgi_label=fg.data[0].value_classification; }
  }catch(e){ console.error('F&G 失败', e.message); }

  // ② 稳定币市值
  try{
    const cg = await fetchJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=tether,usd-coin&order=market_cap_desc&per_page=10&page=1');
    if(Array.isArray(cg)) out.mkt.stable = cg.reduce((s,c)=>s+(c.market_cap||0),0);
  }catch(e){ console.error('稳定币失败', e.message); }

  // ③ Binance 资金费率 + OI + 24h（逐币并发）
  await Promise.all(FUTURES_COINS.map(async(c)=>{
    const r = { funding:null, oi:null, price:null, chg24h:null, vol24h:null };
    try{
      const fr = await fetchJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${c}USDT&limit=1`);
      r.funding = +fr[0].fundingRate;
    }catch(e){}
    try{
      const oi = await fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${c}USDT`);
      r.oi = +oi.openInterest;
    }catch(e){}
    try{
      const t = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${c}USDT`);
      r.price=+t.lastPrice; r.chg24h=+t.priceChangePercent; r.vol24h=+t.quoteVolume;
    }catch(e){}
    out.futures[c]=r;
  }));

  fs.writeFileSync('etf.json', JSON.stringify(out, null, 2));
  console.log('etf.json 已写出');
  console.log('mkt:', JSON.stringify(out.mkt));
  console.log('futures:', JSON.stringify({BTC:out.futures.BTC, ETH:out.futures.ETH}));
  console.log('coins(ETF):', Object.keys(out.coins).length, '个');
}
main().catch(e=>{ console.error(e); process.exit(1); });
