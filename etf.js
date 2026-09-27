'use strict';
// ============================================================================
// ETF 资金流向 + 市场资金面 数据采集（GitHub Actions 定时运行，全部免 key）
// 输出 etf.json，供 etf.html 渲染。
//
// 数据源：
//   · cryptoetf.today  全 13 个现货 ETF 品种资金流（免 key，覆盖 BTC/ETH/SOL/XRP/HYPE/LINK/HBAR/AVAX/DOGE/SUI/LTC/DOT/BNB）
//   · alternative.me   恐惧贪婪指数
//   · CoinGecko        稳定币市值
//   · Binance          资金费率 / OI / 24h涨跌 / 成交额
// ============================================================================
const fs = require('fs');

async function fetchJson(url, headers={}, tries=3){
  for(let i=0;i<tries;i++){
    try{
      const r = await fetch(url, {headers, signal: AbortSignal.timeout(30000)});
      if(!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){ if(i===tries-1) throw e; await new Promise(r=>setTimeout(r,1000*(i+1))); }
  }
}

// asset 名 → ticker
const TICKER = { bitcoin:'BTC', ethereum:'ETH', solana:'SOL', xrp:'XRP', hyp:'HYPE',
  link:'LINK', hbar:'HBAR', avax:'AVAX', doge:'DOGE', sui:'SUI', ltc:'LTC', dot:'DOT', bnb:'BNB' };
const FUTURES_COINS = ['BTC','ETH','SOL','XRP','DOGE','LTC'];

async function main(){
  let out = { updatedAt: new Date().toISOString(), source:'cryptoetf.today', coins:{}, mkt:{}, futures:{} };

  // ① cryptoetf.today 全品种 ETF 资金流
  let fh = {};
  try{
    const [sum, iss, hold] = await Promise.all([
      fetchJson('https://api.cryptoetf.today/api/summary'),
      fetchJson('https://api.cryptoetf.today/api/etf-issuers/overview?days=3650'),
      fetchJson('https://api.cryptoetf.today/api/etf-flow/holdings'),
    ]);
    const issMap = {};
    for(const a of (iss.assets||[])) issMap[String(a.asset).toUpperCase()] = a;
    // 主币种累计净流入在 holdings.summary
    const hs = (hold && hold.summary) || {};
    fh = (hold && hold.fundHoldings) || {};
    const CUM_MAIN = { BTC: hs.totalBtc, ETH: hs.totalEth, SOL: hs.totalSol, XRP: hs.totalXrp, HYPE: hs.totalHyp };
    const ASSET_LOWER = { BTC:'btc', ETH:'eth', SOL:'sol', XRP:'xrp', HYPE:'hyp' };

    for(const [asset, s] of Object.entries(sum)){
      const tk = TICKER[asset];
      if(!tk || !s || s.count==null) continue;
      const ia = issMap[tk] || issMap[asset] || {};
      const cum = CUM_MAIN[tk]!=null ? +CUM_MAIN[tk] : +(ia.cumulative!=null ? ia.cumulative : 0);
      let funds = (ia.funds||[]).map(f=>({ ticker:f.ticker, name:f.name||'', cum:f.cumulative!=null?+f.cumulative:0 })).filter(f=>Math.abs(f.cum)>0.01);
      // 主币种基金明细在 fundHoldings(按发行商)
      if(funds.length===0 && ASSET_LOWER[tk]){
        funds = Object.entries(fh).map(([issuer, hh])=>({ ticker:issuer, name:issuer, cum:+(hh[ASSET_LOWER[tk]]||0) })).filter(f=>Math.abs(f.cum)>0.01).sort((a,b)=>Math.abs(b.cum)-Math.abs(a.cum));
      }
      out.coins[tk] = {
        date: s.latestDate || '',
        daily: +(s.currentFlow) || 0,
        cum: cum,
        aum: +(s.totalAssets) || 0,
        ytd: +(s.ytdFlow) || 0,
        count: s.count,
        funds: funds,
      };
    }
    if(sum.overall) out.mkt.etfTotalAum = +(sum.overall.totalAssets)||0;
    out.mkt.etfTotalFlow = +(sum.overall&&sum.overall.currentFlow)||0;
    out.mkt.etfTotalCount = sum.overall&&sum.overall.totalCount;
  }catch(e){ console.error('cryptoetf.today 失败', e.message); }

  // ② 恐惧贪婪指数
  try{
    const fg = await fetchJson('https://api.alternative.me/fng/?limit=1');
    if(fg && fg.data && fg.data[0]){ out.mkt.fgi=+fg.data[0].value; out.mkt.fgi_label=fg.data[0].value_classification; }
  }catch(e){ console.error('F&G 失败', e.message); }

  // ③ 稳定币市值
  try{
    const cg = await fetchJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=tether,usd-coin&order=market_cap_desc&per_page=10&page=1');
    if(Array.isArray(cg)) out.mkt.stable = cg.reduce((s,c)=>s+(c.market_cap||0),0);
  }catch(e){ console.error('稳定币失败', e.message); }

  // ④ Binance 资金费率 + OI + 24h
  await Promise.all(FUTURES_COINS.map(async(c)=>{
    const r = { funding:null, oi:null, price:null, chg24h:null, vol24h:null };
    try{ const fr = await fetchJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${c}USDT&limit=1`); r.funding=+fr[0].fundingRate; }catch(e){}
    try{ const oi = await fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${c}USDT`); r.oi=+oi.openInterest; }catch(e){}
    try{ const t = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${c}USDT`); r.price=+t.lastPrice; r.chg24h=+t.priceChangePercent; r.vol24h=+t.quoteVolume; }catch(e){}
    out.futures[c]=r;
  }));

  out.issuers = fh;   // 发行商跨币种持仓(近似一篮子)
  fs.writeFileSync('etf.json', JSON.stringify(out, null, 2));
  console.log('etf.json 已写出：', Object.keys(out.coins).length, '个 ETF 品种');
  console.log('mkt:', JSON.stringify(out.mkt).slice(0,200));
}
main().catch(e=>{ console.error(e); process.exit(1); });
