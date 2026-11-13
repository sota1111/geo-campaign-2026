import fs from 'node:fs';
const tab=(await (await fetch('http://127.0.0.1:9310/json/list')).json()).find(t=>t.type==='page');
const ws=new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r); let id=0; const pending=new Map(); ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};
const call=(method,params={})=>new Promise(r=>{let n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}))});
const ev=async expression=>(await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.result?.value;
const arg=process.argv[2];
const mobile=process.argv.includes('--mobile'); await call('Emulation.setDeviceMetricsOverride',{width:mobile?390:1280,height:mobile?844:765,deviceScaleFactor:1,mobile:false});
if(arg==='nav'){await call('Emulation.setDeviceMetricsOverride',{width:1280,height:765,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:process.argv[3]});await new Promise(r=>setTimeout(r,1800));}
if(arg==='eval')console.log(await ev(process.argv[3]));
if(arg==='shot'){if(process.argv[4] && process.argv[4]!=='--mobile') await ev(process.argv[4]); await new Promise(r=>setTimeout(r,300));await call('Page.captureScreenshot',{format:'png'}).then(x=>fs.writeFileSync('reports/ops/dashboard-eval-20261113/eval-10/'+process.argv[3]+'.png',Buffer.from(x.result.data,'base64')))}
if(arg==='mobile') await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
if(arg==='click'){const p=await ev(`(()=>{let e=[...document.querySelectorAll('button,a')].find(e=>e.innerText===${JSON.stringify(process.argv[3])}&&e.getBoundingClientRect().width);let r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});}
if(arg==='key'){await call('Input.dispatchKeyEvent',{type:'keyDown',key:process.argv[3],code:process.argv[3],text:process.argv[3]==='Enter'?'\r':undefined,windowsVirtualKeyCode:process.argv[3]==='Tab'?9:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:process.argv[3],code:process.argv[3]});console.log(await ev('document.activeElement?.outerHTML.slice(0,300)'));}
if(arg==='pdf'){const r=await call('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});fs.writeFileSync('reports/ops/dashboard-eval-20261113/eval-10/'+process.argv[3]+'.pdf',Buffer.from(r.result.data,'base64'));}
if(arg==='close')await call('Browser.close');
ws.close();
