import { chromium } from '@playwright/test'; import { resolve } from 'path';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:1920,height:1080}}); const p=await ctx.newPage();
await p.route('**://**',r=>{const u=r.request().url();
  if(u.startsWith('file:'))return r.continue();
  if(/tailwind/.test(u))return r.fulfill({path:process.argv[3],contentType:'application/javascript'});
  return r.abort();});
await p.goto('file://'+resolve(process.argv[2]),{waitUntil:'load'}); await p.waitForTimeout(1200);
console.log(await p.evaluate(()=>{
  const q=s=>document.querySelector(s);
  const box=e=>e?`${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}@${Math.round(e.getBoundingClientRect().left)},${Math.round(e.getBoundingClientRect().top)}`:'—';
  const m=q('main'), bb=m?m.getBoundingClientRect():null;
  return `aside ${box(q('aside'))}  header ${box(q('header'))}  main ${box(m)}  `
    +`main首屏露出=${bb?Math.round(Math.max(0,Math.min(bb.bottom,innerHeight)-Math.max(bb.top,0))):0}px`;
}));
if(process.argv[4]) await p.screenshot({path:process.argv[4]});
await b.close();
