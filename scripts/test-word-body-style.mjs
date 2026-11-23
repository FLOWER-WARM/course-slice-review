import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
const url=process.argv[2]?new URL(process.argv[2]).href:pathToFileURL(resolve('course-slice-review.html')).href;
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const cdpPort=probe.address().port;await new Promise(r=>probe.close(r));
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--remote-debugging-port='+cdpPort,'--user-data-dir='+await mkdtemp(join(tmpdir(),'course-slices-')),url],{stdio:'ignore',windowsHide:true});
let ws;
try{
 let page;
 for(let i=0;i<100&&!page;i++){try{page=(await(await fetch('http://127.0.0.1:'+cdpPort+'/json/list')).json()).find(p=>p.url===url);}catch{}if(!page)await delay(200);}
 if(!page)throw Error('Browser did not load');
 ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');
 let id=0;
 function call(method,params={}){
  const key=++id;
  return new Promise((yes,no)=>{
   const timer=setTimeout(()=>no(Error(method+' timed out')),180000);
   ws.addEventListener('message',function on(event){const r=JSON.parse(event.data);if(r.id!==key)return;clearTimeout(timer);ws.removeEventListener('message',on);r.error?no(Error(JSON.stringify(r.error))):yes(r.result);});
   ws.send(JSON.stringify({id:key,method,params}));
  });
 }
 async function run(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
 let ready=false;
 for(let i=0;i<200;i++){ready=await run("typeof exportWordSlices==='function' && typeof JSZip!=='undefined'");if(ready)break;await delay(150);}
 if(!ready)throw Error('Word export dependency did not load');
 async function upload(selector,file){const {root}=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector});await call('DOM.setFileInputFiles',{nodeId,files:[file]});}



 // Optional isolation of the final formatter when CDN download is unavailable.
 // First run the full test to create the synthetic full.docx fixture.
 if(process.argv.includes('--formatter-only')) {
  const base64=(await readFile(resolve('local-model/style-regression/full.docx'))).toString('base64');
  await run(`(async()=>{const bytes=Uint8Array.from(atob('${base64}'),c=>c.charCodeAt(0));const zip=await JSZip.loadAsync(bytes);let xml=await zip.file('word/document.xml').async('string');let i=0;xml=xml.replaceAll('w:val="Normal"',()=> 'w:val="'+['FirstParagraph','BodyText','Compact'][i++%3]+'"');zip.file('word/document.xml',xml);const blob=await zip.generateAsync({type:'blob'});convertBrowserWord=async()=>blob;return true;})()`);
 }
 const result=await run(String.raw`(async()=>{
   let saved;download=(blob,name)=>{saved={blob,name}};
   await exportWordSlices([{title:'样式回归',cat:'测试',kp:'课程/测试',src:'合成资料',format:'文本/表格/公式/代码',content:'<p>第一段正文</p><p>第二段正文</p><p>【图片标题】图题</p><table><tr><td>单元格正文</td></tr></table><p>公式 $x^2$</p><pre><code class="language-python">a = 1\nb = 2</code></pre>'}],'样式回归');
   if(!saved)throw Error(document.body.innerText.slice(-400));
   const zip=await JSZip.loadAsync(saved.blob);const xml=await zip.file('word/document.xml').async('string');
   const dom=new DOMParser().parseFromString(xml,'application/xml');
   const pars=Array.from(dom.getElementsByTagNameNS('*','p')).map(p=>({text:Array.from(p.getElementsByTagNameNS('*','t')).map(n=>n.textContent).join(''),style:p.getElementsByTagNameNS('*','pStyle')[0]?.getAttribute('w:val')}));
   for(const text of ['第一段正文','第二段正文','【图片标题】图题','单元格正文'])if(!pars.some(p=>p.text===text&&p.style==='Normal'))throw Error('Wrong body style '+text+JSON.stringify(pars));
   if(pars.some(p=>['FirstParagraph','BodyText','Compact'].includes(p.style)))throw Error('Ordinary styles remain');
   if(!pars.some(p=>p.style==='Heading1')||!pars.some(p=>p.style==='Heading2')||!pars.some(p=>p.style==='SourceCode'))throw Error('Special styles damaged');
   if(!dom.getElementsByTagNameNS('*','oMath').length)throw Error('Editable math lost');
   const bytes=new Uint8Array(await saved.blob.arrayBuffer());let b='';for(let i=0;i<bytes.length;i+=8192)b+=String.fromCharCode(...bytes.subarray(i,i+8192));
   return {base64:btoa(b),paragraphs:pars,math:true,serverMode:typeof serverMode!=='undefined' && serverMode,url:location.href};
 })()`);
 const dir=resolve('local-model/style-regression');await mkdir(dir,{recursive:true});const label=result.serverMode?'server':result.url.includes('prompt-demo')?'demo':'full';
 await writeFile(join(dir,label+'.docx'),Buffer.from(result.base64,'base64'));delete result.base64;result.formatterOnly=process.argv.includes('--formatter-only');
 await writeFile(join(dir,label+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({label,passed:true,paragraphs:result.paragraphs.length,math:result.math}));
}finally{ws?.close();edge.kill();}
