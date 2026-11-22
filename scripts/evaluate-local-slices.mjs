import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('local-model');
await mkdir(root, { recursive: true });
const source = JSON.parse(await readFile(resolve(root, 'test-source.json'), 'utf8')).text;
const html = await readFile('course-slice-review.html', 'utf8');
const promptStart = html.indexOf('  const PROMPT_LINES');
const promptEnd = html.indexOf('\n  ];', promptStart);
if (promptStart < 0 || promptEnd < 0) throw Error('Cannot find generator prompt');
const promptLiteral = html.slice(html.indexOf('[', promptStart), promptEnd + 4).trim().replace(/;$/, '');
const base = Function('return ' + promptLiteral)().join('\n')
  .replaceAll('{{课程名}}', '模型切片测试').replaceAll('{{教材范围}}', '提供的原文')
  .replaceAll('{{分类}}', '测试课程').replaceAll('{{来源}}', '本地测试资料');
const tests = [
  { id:'textbook', title:'一、喉的结构', source, required:['喉的软骨','喉腔','喉的神经'], forbidden:['二、喉的功能'] },
  { id:'missing', title:'鼻的血液供应', source:'本段仅介绍喉的位置：喉位于颈前部中央，上通喉咽，下接气管。', exact:'教材本节未涉及' },
  { id:'table', title:'质能关系与样本数据', source:'本节介绍质能关系与样本数据。关系式 E=mc²。表1 样本数据。两列表头为“样本”“数值”，数据分别为 A 对应 2，B 对应 3。', required:['$','|','A','B','2','3','【表格标题】','【表格描述】'] }
];
const records = [], exports = [], preferences = [];
const runId = new Date().toISOString().replaceAll(':','-');
for (const test of tests) {
  const correction = "\n补充输出约束：正文只覆盖标题对应的小节，遇到同级下一标题立即停止。原文提供表格数据时必须用 Markdown 管道表格展示，不能只用一句话复述数据；表后单独两行写【表格标题】和【表格描述】。\n";
  const prompt = base + correction + '\n\n# 切片清单\n' + test.title + '\n\n# 教材原文\n' + test.source;
  const messages = [{role:'user', content:prompt}];
  let rejected;
  for (let round=1; round<=3; round++) {
    const started=Date.now();
    const response=await fetch('http://127.0.0.1:11435/api/chat', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'qwen3.5:4b',think:false,stream:false,messages,
        options:{num_ctx:8192,num_predict:2000,temperature:0,seed:42}}),
      signal:AbortSignal.timeout(180000)
    });
    if(!response.ok) throw Error('Model HTTP '+response.status);
    const data=await response.json();
    const output=data.message.content.trim();
    const body=output.replace(/^#[^\n]*\n\s*/, '').trim();
    const errors=[];
    if(output.split('\n')[0] !== '# '+test.title) errors.push('首行必须逐字输出 # '+test.title);
    if((output.match(/^# /gm)||[]).length!==1) errors.push('只输出一个切片');
    if(data.done_reason==='length') errors.push('正文被截断，需要缩短并完成内容');
    for(const term of test.required||[]) if(!output.includes(term)) errors.push('缺少原文明示的内容或格式 '+term);
    for(const term of test.forbidden||[]) if(output.includes(term)) errors.push('含有相邻知识点 '+term);
    if(test.exact && body!==test.exact) errors.push('原文缺少该知识点，正文必须只写 '+test.exact);
    if(!test.exact && body==='教材本节未涉及') errors.push('原文明示了该知识点，应整理已提供材料');
    const score=Math.max(0,100-errors.length*20);
    const record={id:test.id,title:test.title,round,score,errors,seconds:(Date.now()-started)/1000,output,review:'automatic-only'};
    records.push(record);
    console.log(JSON.stringify({id:test.id,round,score,errors}));
    if(!errors.length){
      exports.push(output);
      if(rejected) preferences.push({prompt,chosen:output,rejected,review:'pending-human-review'});
      break;
    }
    rejected=output;
    messages.push({role:'assistant',content:output},{role:'user',content:'校验扣分 '+(100-score)+' 分。请依据原文修正以下问题，重新输出完整切片：\n'+errors.join('\n')+'\n如原文包含表头和行数据，请以 | 表头 | 表头 |、| --- | --- | 和逐行数据的 Markdown 表格输出。'});
  }
}
await writeFile(resolve(root,'切片测试-可导入.md'), exports.join('\n\n')+'\n');
await writeFile(resolve(root,'切片测试-评测记录.json'),JSON.stringify(records,null,2));
await writeFile(resolve(root,'切片测试-待审核偏好样本.jsonl'), preferences.map(x=>JSON.stringify(x)).join('\n'));
const titles=tests.filter(t=>exports.some(s=>s.startsWith('# '+t.title+'\n')));
const csv='根节点,二级知识点,三级知识点\n'+titles.map(t=>'模型切片测试,本地模型评测,"'+t.title.replaceAll('"','""')+'"').join('\n')+'\n';
await writeFile(resolve(root,'切片测试-骨架.csv'),'\ufeff'+csv);
await writeFile(resolve(root,'评测记录-'+runId+'.json'), JSON.stringify(records,null,2));
console.log('Saved importable Markdown, matching skeleton CSV, scores and unreviewed preference pairs.');
