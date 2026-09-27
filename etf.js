// ============================================================================
// ETF 资金流向 + 市场情绪 数据采集（GitHub Actions 定时运行）
// 输出 etf.json，供 etf.html 渲染。
//
// 数据源（按优先级）：
//   1. CoinGlass ETF 资金流（需 COINGLASS_API_KEY，存 GitHub secrets）
//   2. alternative.me 恐惧贪婪指数（免 key）
//   3. CoinGecko 稳定币市值（免 key，项目已在用）
// ============================================================================
'use strict';
const fs = require('fs');
const KEY = process.env.COINGLASS_API_KEY || '';

async function fetchJson(url, headers={}, tries=3){
  for(let i=0;i<tries;i++){
    try{
      const r = await fetch(url, {headers, signal: AbortSignal.timeout(20000)});
      if(!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){ if(i===tries-1) throw e; await new Promise(r=>setTimeout(r,800*(i+1))); }
  }
}

async function main(){
  const out = { updatedAt: new Date().toISOString(), coins: {}, mkt: {} };

  // ① 恐惧贪婪指数（免 key）
  try{
    const fg = await fetchJson('https://api.alternative.me/fng/?limit=1');
    if(fg && fg.data && fg.data[0]){
      out.mkt.fgi = +fg.data[0].value;
      out.mkt.fgi_label = fg.data[0].value_classification;
    }
  }catch(e){ console.error('F&G 失败', e.message); }

  // ② 稳定币市值 USDT+USDC（CoinGecko 免 key）
  try{
    const cg = await fetchJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=tether,usd-coin&order=market_cap_desc&per_page=10&page=1&sparkline=false');
    if(Array.isArray(cg)) out.mkt.stable = cg.reduce((s,c)=>s+(c.market_cap||0),0);
  }catch(e){ console.error('稳定币失败', e.message); }

  // ③ CoinGlass ETF 资金流（需 key）
  //    待接入：拿到 COINGLASS_API_KEY 后，填充 out.coins 结构：
  //    out.coins.BTC = { flow: {date, daily, cum, streak, aum, series}, funds:[{ticker,name,net,cum,aum}] }
  //    CoinGlass 开放接口参考：https://open-api.coinglass.com/public/v2/etf/...
  if(KEY){
    try{
      // TODO: 待确认 CoinGlass ETF 精确端点后接入
      // const etf = await fetchJson('https://open-api.coinglass.com/public/v2/etf/flow_history?symbol=BTC',
      //                            {'CG-API-KEY': KEY, 'accept':'application/json'});
      // ... 解析并填充 out.coins
      console.log('COINGLASS_API_KEY 已配置，ETF 端点待接入');
    }catch(e){ console.error('CoinGlass 失败', e.message); }
  }else{
    console.log('未配置 COINGLASS_API_KEY，ETF 资金流暂缺');
  }

  fs.writeFileSync('etf.json', JSON.stringify(out, null, 2));
  console.log('etf.json 已写出', JSON.stringify(out.mkt));
}
main().catch(e=>{ console.error(e); process.exit(1); });
