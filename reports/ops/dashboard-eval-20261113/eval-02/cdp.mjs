import fs from 'node:fs';
const base='reports/ops/dashboard-eval-20261113/eval-02/';
const targets=await(await fetch('http://127.0.0.1:9302/json')).json();
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map();ws.onmessage=e=>{let m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};const c=(method,params={})=>new Promise(r=>{pending.set(++id,r);ws.send(JSON.stringify({id,method,params}))});
await c('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:process.cwd()+'/'+base});await c('Page.enable');await c('Runtime.enable');await c('Page.bringToFront');await c('Emulation.setFocusEmulationEnabled',{enabled:true});
const ev=async expression=>(await c('Runtime.evaluate',{expression:'{ const document = globalThis.document.querySelector("iframe")?.contentDocument || globalThis.document; '+expression+' }',returnByValue:true,awaitPromise:true})).result?.result?.value;
const [action,arg,arg2]=process.argv.slice(2);
if(action==='size')fs.writeFileSync(base+'viewport.json',JSON.stringify([+arg,+arg2]));
const [width,height]=fs.existsSync(base+'viewport.json')?JSON.parse(fs.readFileSync(base+'viewport.json')):[1280,765];await c('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});await new Promise(r=>setTimeout(r,350));
if(action==='nav'){await c('Page.navigate',{url:arg});await new Promise(r=>setTimeout(r,1800));}
if(action==='eval')console.log(await ev(arg));
if(action==='click'){console.log(await ev(`(()=>{let e=[...document.querySelectorAll('button,a,summary')].find(e=>e.innerText.trim()===${JSON.stringify(arg)});if(!e)return 'NOT FOUND';e.click();return e.outerHTML})()`));await new Promise(r=>setTimeout(r,800));}
if(action==='size')await c('Emulation.setDeviceMetricsOverride',{width:Number(arg),height:Number(arg2),deviceScaleFactor:1,mobile:Number(arg)<500});
if(action==='key'){await c('Input.dispatchKeyEvent',{type:'rawKeyDown',key:arg,code:arg,windowsVirtualKeyCode:arg==='Tab'?9:arg==='Escape'?27:13});await c('Input.dispatchKeyEvent',{type:'keyUp',key:arg,code:arg,windowsVirtualKeyCode:arg==='Tab'?9:arg==='Escape'?27:13});await new Promise(r=>setTimeout(r,300));console.log(await ev('document.activeElement.outerHTML'));}
if(action==='shot'){await c('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(base+arg+'.png',Buffer.from(r.result.data,'base64')));}
if(action==='text'||action==='nav'||action==='click')console.log(await ev('document.body.innerText'));
ws.close();
