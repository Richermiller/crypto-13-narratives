'use strict';
// ============================================================================
// ETF 资金流 + 数据分析 采集（GitHub Actions 定时运行，全免 key）
// 输出 etf.json，供 index.html(ETF监控台) 渲染。
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

const TICKER = { bitcoin:'BTC', ethereum:'ETH', solana:'SOL', xrp:'XRP', hyp:'HYPE',
  link:'LINK', hbar:'HBAR', avax:'AVAX', doge:'DOGE', sui:'SUI', ltc:'LTC', dot:'DOT', bnb:'BNB' };
// 日线序列端点
const FLOW_EP = { BTC:'bitcoin', ETH:'eth', SOL:'solana', XRP:'xrp', HYPE:'hyp',
  LINK:'assets/link', HBAR:'assets/hbar', AVAX:'assets/avax', DOGE:'assets/doge',
  SUI:'assets/sui', LTC:'assets/ltc', DOT:'assets/dot', BNB:'assets/bnb' };
const FUTURES_COINS = ['BTC','ETH','SOL','XRP','DOGE','LTC'];
const today = new Date().toISOString().slice(0,10);

function stats(series, lastDate){
  // 统一按日期升序(主币接口是倒序、山寨币是正序)，只用已披露日线
  const sorted = [...(series||[])].sort((a,b)=> a.date<b.date?-1 : a.date>b.date?1 : 0);
  const valid = sorted.filter(r => !lastDate || r.date <= lastDate);
  const vals = valid.map(r=>+r.total||0);
  const avg = (n) => { const s=vals.slice(-n); return s.length? s.reduce((a,b)=>a+b,0)/s.length : null; };
  const last = vals[vals.length-1], prev = vals[vals.length-2];
  return {
    prevChange: last!=null&&prev!=null ? last-prev : null,
    avg7: avg(7), avg30: avg(30),
    ratio: (()=>{ const a7=avg(7), a30=avg(30); return (a7!=null&&a30!=null&&a30!==0)? a7/a30 : null; })(),
  };
}

async function main(){
  let out = { updatedAt: new Date().toISOString(), source:'cryptoetf.today', coins:{}, mkt:{}, futures:{}, issuers:{} };
  let fh = {};

  // ① cryptoetf.today 汇总
  try{
    const [sum, iss, hold] = await Promise.all([
      fetchJson('https://api.cryptoetf.today/api/summary'),
      fetchJson('https://api.cryptoetf.today/api/etf-issuers/overview?days=3650'),
      fetchJson('https://api.cryptoetf.today/api/etf-flow/holdings'),
    ]);
    const issMap = {};
    for(const a of (iss.assets||[])) issMap[String(a.asset).toUpperCase()] = a;
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
      if(funds.length===0 && ASSET_LOWER[tk]){
        funds = Object.entries(fh).map(([issuer, hh])=>({ ticker:issuer, name:issuer, cum:+(hh[ASSET_LOWER[tk]]||0) })).filter(f=>Math.abs(f.cum)>0.01).sort((a,b)=>Math.abs(b.cum)-Math.abs(a.cum));
      }
      out.coins[tk] = {
        date: s.latestDate || '', daily: +(s.currentFlow)||0, cum: cum,
        aum: +(s.totalAssets)||0, ytd: +(s.ytdFlow)||0, count: s.count, funds: funds,
        avg7:null, avg30:null, ratio:null, prevChange:null,
      };
    }
    if(sum.overall) out.mkt.etfTotalAum = +(sum.overall.totalAssets)||0;
    out.mkt.etfTotalFlow = +(sum.overall&&sum.overall.currentFlow)||0;
    out.mkt.etfTotalCount = sum.overall&&sum.overall.totalCount;
  }catch(e){ console.error('cryptoetf.today 汇总失败', e.message); }

  // ② 13 个币种的日线序列 → 7日/30日均值、比值、较前一日变化
  await Promise.all(Object.entries(FLOW_EP).map(async([tk, ep])=>{
    try{
      const series = await fetchJson('https://api.cryptoetf.today/api/etf-flow/'+ep);
      if(out.coins[tk]){
        const st = stats(series, out.coins[tk] && out.coins[tk].date);
        Object.assign(out.coins[tk], { prevChange: st.prevChange, avg7: st.avg7, avg30: st.avg30, ratio: st.ratio });
      }
    }catch(e){ console.error('日线 '+tk+' 失败', e.message); }
  }));

  // 全球总流入变化
  {
    const totals = Object.values(out.coins).map(c=>c.daily).filter(v=>v!=null);
    out.mkt.etfTotalFlow = totals.reduce((a,b)=>a+b,0);
    const prevs = Object.values(out.coins).map(c=>c.daily-(c.prevChange||0)).filter(v=>v!=null);
    out.mkt.etfPrevChange = totals.reduce((a,b)=>a+b,0) - (prevs.length?prevs.reduce((a,b)=>a+b,0):0);
  }

  // ③ 恐惧贪婪
  try{
    const fg = await fetchJson('https://api.alternative.me/fng/?limit=1');
    if(fg && fg.data && fg.data[0]){ out.mkt.fgi=+fg.data[0].value; out.mkt.fgi_label=fg.data[0].value_classification; }
  }catch(e){}

  // ④ 稳定币市值
  try{
    const cg = await fetchJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=tether,usd-coin&order=market_cap_desc&per_page=10&page=1');
    if(Array.isArray(cg)) out.mkt.stable = cg.reduce((s,c)=>s+(c.market_cap||0),0);
  }catch(e){}

  out.issuers = fh;
  fs.writeFileSync('etf.json', JSON.stringify(out, null, 2));
  console.log('etf.json 已写出：', Object.keys(out.coins).length, '个品种');
  for(const k of ['BTC','ETH','LINK']){
    const c=out.coins[k]; if(c) console.log(`  ${k}: daily ${c.daily}  avg7 ${c.avg7?.toFixed(1)}  avg30 ${c.avg30?.toFixed(1)}  ratio ${c.ratio?.toFixed(2)}  prevChange ${c.prevChange?.toFixed(1)}`);
  }
}
main().catch(e=>{ console.error(e); process.exit(1); });
