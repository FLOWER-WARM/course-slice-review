import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp} from 'node:fs/promises';
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
 for(let i=0;i<200;i++){ready=await run("typeof readPptxSource==='function' && typeof JSZip!=='undefined'");if(ready)break;await delay(150);}
 if(!ready)throw Error('PPTX dependency did not load');
 async function upload(selector,file){const {root}=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector});await call('DOM.setFileInputFiles',{nodeId,files:[file]});}


 const result=await run(`(async()=>{
  const zip=new JSZip();
  const ns='xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const shape=(text,type='')=>'<p:sp>'+(type?'<p:nvSpPr><p:nvPr><p:ph type="'+type+'"/></p:nvPr></p:nvSpPr>':'')+'<p:txBody>'+text.map(t=>'<a:p><a:r><a:t>'+t+'</a:t></a:r></a:p>').join('')+'</p:txBody></p:sp>';
  const slide=body=>'<p:sld '+ns+'><p:cSld><p:spTree>'+body+'</p:spTree></p:cSld></p:sld>';
  zip.file('ppt/presentation.xml','<p:presentation '+ns+'><p:sldIdLst>'+[2,10,3,4].map(i=>'<p:sldId id="'+(256+i)+'" r:id="r'+i+'"/>').join('')+'</p:sldIdLst></p:presentation>');
  zip.file('ppt/_rels/presentation.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+[2,10,3,4].map(i=>'<Relationship Id="r'+i+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide'+i+'.xml"/>').join('')+'</Relationships>');
  zip.file('ppt/slides/slide2.xml',slide(shape(['第 1.1 节','另一种标题','✓ 可做','✗ 不可做'])+shape(['99'],'sldNum')+'<p:grpSp>'+shape(['分组文字'])+'</p:grpSp>'));
  zip.file('ppt/slides/_rels/slide2.xml.rels','<Relationships><Relationship Id="n" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="https://example.invalid/notes.xml" TargetMode="External"/></Relationships>');
  zip.file('ppt/notesSlides/notesSlide1.xml','<p:notes '+ns+'>'+shape(['教师重要限定'],'body')+shape(['页脚不应进入资料'],'ftr')+'</p:notes>');
  zip.file('ppt/slides/slide10.xml',slide(shape(['正文'])+'<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>表格甲</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>表格乙</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>'));
  zip.file('ppt/slides/slide3.xml',slide(shape(['综合实操','任务与验收'])));
  zip.file('ppt/slides/slide4.xml',slide('<p:pic/>'));
  const book=await readPptxSource(new File([await zip.generateAsync({type:'arraybuffer'})],'模块一_课件.pptx'));
  book.name='模块一_课件.pptx';book.id='test';
  const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
  assert(book.pptxPages.length===4 && book.pptxPages[0].text.includes('第 1.1 节') && book.pptxPages[1].text.includes('表格甲 | 表格乙'),'Presentation order / table extraction');
  assert(book.pptxPages[0].text.includes('分组文字') && !book.pptxPages[0].text.includes('99'),'Groups / page number filtering');
  assert(book.text.includes('教师重要限定') && !book.text.includes('页脚不应进入资料'),'Notes / boilerplate');
  assert(book.pptxPages[0].text.includes('✗ 不可做'),'Prohibition marker preservation');
  assert(JSON.stringify(book.imageOnlyPages)==='[4]','Image-only warning');
  assert(findPptxSection([book],{title:'1.1 图谱名称不同'}).text.includes('表格甲'),'Code mapping across different labels');
  const second={...book,name:'模块二_课件.pptx'};
  const practice={title:'综合实操',kp:'课程/模块二 名称/综合实操'};
  assert(scopePptxBooks([book,second],practice)[0]===second,'Duplicate practice module scope');
  let ambiguous=false;try{findPptxSection([book,second],practice)}catch{ambiguous=true}assert(ambiguous,'Ambiguity rejected');
  assert(scopePptxBooks([book],{kp:'课程/模块二 名称/综合实操'}).length===0,'Missing module rejected');
  const broken=new JSZip();broken.file('ppt/presentation.xml','<broken>');let invalid=false;
  try{await readPptxSource(new File([await broken.generateAsync({type:'arraybuffer'})],'bad.pptx'))}catch{invalid=true}assert(invalid,'Malformed XML rejected');
  let legacy=false;try{await readTextbook(new File(['test'],'old.ppt'))}catch(e){legacy=e.message.includes('PPTX')}assert(legacy,'Legacy PPT guidance');
  return {checks:11,status:'passed',url:location.href};
 })()`);
 console.log(JSON.stringify(result));
}finally{ws?.close();edge.kill();}
