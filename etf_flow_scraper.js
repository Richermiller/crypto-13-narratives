// ============================================================================
// Farside ETF 资金流抓取（本地运行，因为 Farside 有 Cloudflare 反爬，GitHub Actions 过不了）
//
// 安装（一次性）：
//   npm install playwright
//   npx playwright install chromium
//
// 运行：
//   node etf_flow_scraper.js            → 只抓取并写 etf_flow.json
//   node etf_flow_scraper.js --push     → 抓取后自动 git 提交推送
//
// 覆盖：BTC / ETH / SOL 现货 ETF 每日净流入（US$m）
// ============================================================================
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const PAGES = { BTC:'/btc/', ETH:'/eth/', SOL:'/sol/' };

const num = t => {
  if(!t || t==='-' || t==='') return 0;
  const s = t.replace(/,/g,'').replace(/[()]/g,'');
  const n = parseFloat(s);
  if(isNaN(n)) return 0;
  return t.includes('(') ? -n : n;
};

async function scrapeCoin(page, path){
  await page.goto('https://farside.co.uk'+path, {waitUntil:'domcontentloaded', timeout:60000});
  await page.waitForSelector('table tbody tr td', {timeout:60000});
  const raw = await page.evaluate(()=>{
    const ths=[...document.querySelectorAll('table thead tr th')].map(t=>t.textContent.trim());
    const rows=[...document.querySelectorAll('table tbody tr')].map(tr=>[...tr.querySelectorAll('td')].map(td=>td.textContent.trim()));
    return {ths, rows};
  });
  // 找基金 ticker（表头里 "Total" 之后的大写字母）
  const ti = raw.ths.indexOf('Total');
  const tickers = raw.ths.slice(ti+1).filter(t=>/^[A-Z]{2,6}$/.test(t));
  // 每日行 = 首列是日期(形如 "25 Sep 2026")
  const dailyRows = raw.rows.filter(r=>/^\d{2} [A-Z][a-z]{2} \d{4}$/.test(r[0]||''));
  // 累计行 = 首列 "Total"
  const cumRow = raw.rows.find(r=>r[0]==='Total') || [];
  // 数据列：第1~len(tickers) 列是基金，最后一列是 Total
  const totalCol = dailyRows[0] ? dailyRows[0].length-1 : tickers.length;
  const latest = dailyRows[dailyRows.length-1] || [];
  const date = latest[0] || '';
  const daily = num(latest[totalCol]);
  const cum = num(cumRow[totalCol]);
  const series = dailyRows.map(r=>num(r[totalCol]));
  const funds = tickers.map((t,i)=>{
    const col = i+1; // 数据列从第1列开始是第一个基金
    return { ticker:t, name:'', net:num(latest[col]), cum:num(cumRow[col]) };
  }).filter(f=>f.cum!==0 || f.net!==0).sort((a,b)=>Math.abs(b.cum)-Math.abs(a.cum));
  const MON={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  const dp=date.split(' ');
  const iso = dp.length===3 ? dp[2]+'-'+(MON[dp[1]]||dp[1])+'-'+dp[0] : date;
  return { date: iso, daily, cum, series, funds };
}

(async()=>{
  // 保留旧数据：失败的币种不覆盖
  let out;
  try { out = JSON.parse(fs.readFileSync('etf_flow.json','utf8')); } catch(e){}
  if(!out || !out.coins) out = { coins:{} };
  out.updatedAt = new Date().toISOString().slice(0,10);
  out.source = 'Farside Investors (farside.co.uk)';

  const context = await chromium.launchPersistentContext('/tmp/farside-pw-profile', {channel:'chrome', headless:false, args:['--disable-blink-features=AutomationControlled','--window-position=-3000,-3000']});
  for(const [coin,path] of Object.entries(PAGES)){
    let ok=false;
    for(let attempt=1; attempt<=3 && !ok; attempt++){
      const page = await context.newPage();
      try{
        const r = await scrapeCoin(page, path);
        out.coins[coin] = r;
        console.log(`✅ ${coin}: 最新 ${r.daily}M | 累计 ${r.cum}M`);
        ok=true;
      }catch(e){ console.error(`❌ ${coin} 第${attempt}次失败:`, e.message); }
      await page.close();
      await new Promise(r=>setTimeout(r,4000));
    }
  }
  await context.close();
  fs.writeFileSync('etf_flow.json', JSON.stringify(out, null, 2));
  console.log('etf_flow.json 已写出（含 '+Object.keys(out.coins).length+' 个币种）');

  if(process.argv.includes('--push')){
    try{
      execSync('git add etf_flow.json && git commit -m "auto: ETF资金流更新 '+out.updatedAt+'" && git pull --rebase origin main && git push origin main', {stdio:'inherit'});
      console.log('已推送到 GitHub');
    }catch(e){ console.error('推送失败(可能无变化或需手动)', e.message); }
  }
})().catch(e=>{ console.error(e); process.exit(1); });
