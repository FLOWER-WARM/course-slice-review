"""Local QLoRA pilot. No textbook or examples leave this machine."""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
import json, math, random, time, hashlib
from pathlib import Path
import torch
import torch.nn.functional as F
from torch.utils.checkpoint import checkpoint
from transformers import AutoTokenizer, AutoConfig, BitsAndBytesConfig, Qwen3_5ForCausalLM
from peft import LoraConfig, PeftModel, get_peft_model, prepare_model_for_kbit_training

import argparse
parser = argparse.ArgumentParser(description='Local Qwen3.5 text QLoRA training with held-out validation')
parser.add_argument('--dataset-dir', required=True, type=Path)
parser.add_argument('--base-model-dir', required=True, type=Path)
parser.add_argument('--epochs', type=int, default=2)
parser.add_argument('--initial-adapter', type=Path, help='Continue supervised training from an existing local PEFT adapter')
parser.add_argument('--probe-ids', default='')
parser.add_argument('--probe-max-tokens',type=int,default=512)
parser.add_argument('--probe-max-seconds',type=float,default=120)
args = parser.parse_args()
if args.epochs < 1: parser.error('--epochs must be positive')
ROOT = args.dataset_dir.resolve()
BASE = args.base_model_dir.resolve()
OUT = ROOT / 'adapter'
PROBES = set(filter(None,args.probe_ids.split(',')))
random.seed(42)
torch.manual_seed(42)
torch.set_num_threads(4)
if not torch.cuda.is_available():
    raise RuntimeError('GPU PyTorch is required; refusing accidental CPU training')
torch.backends.cuda.matmul.allow_tf32 = True
print('GPU', torch.cuda.get_device_name(), 'torch', torch.__version__, flush=True)
tok = AutoTokenizer.from_pretrained(BASE, local_files_only=True)
config = AutoConfig.from_pretrained(BASE, local_files_only=True)

def read_data(name):
    rows = [json.loads(s) for s in (ROOT / (name + '.jsonl')).read_text(encoding='utf-8').splitlines()]
    encoded = []
    for row in rows:
        messages = row['messages']
        # Always retain the full reviewed answer. Long candidate extracts are reduced
        # by title/path relevance only, identically for training and held-out data.
        prompt_messages = messages[:2]
        prompt = tok.apply_chat_template(prompt_messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        prefix = tok.encode(prompt, add_special_tokens=False)
        answer = tok.encode(messages[2]['content'] + tok.eos_token, add_special_tokens=False)
        if len(prefix) + len(answer) > 6144:
            user = messages[1]['content']
            head, source = user.split('教材候选原文：\n', 1)
            query = ''.join(row['path'][2:])
            grams = set(query[i:i+2] for i in range(len(query)-1))
            lines = source.splitlines()
            scores = [sum(g in line for g in grams) / max(1, len(line)**0.3) for line in lines]
            keep = set()
            for i in sorted(range(len(lines)), key=lambda i: scores[i], reverse=True):
                for j in range(max(0, i-2), min(len(lines), i+4)): keep.add(j)
                candidate = '\n'.join(lines[j] for j in sorted(keep))
                test = [messages[0], {'role':'user', 'content': head+'教材候选原文：\n'+candidate}]
                text = tok.apply_chat_template(test, tokenize=False, add_generation_prompt=True, enable_thinking=False)
                ids = tok.encode(text, add_special_tokens=False)
                if len(ids) + len(answer) > 6000: break
                prefix, prompt_messages = ids, test
        if len(prefix) + len(answer) > 6144:
            raise ValueError('Example too long, never silently truncate answer: '+row['id'])
        encoded.append(dict(id=row['id'], ids=prefix+answer, start=len(prefix), prompt_messages=prompt_messages))
    return encoded

train = read_data('train')
valid = read_data('validation')
print('DATA', len(train), len(valid), 'max tokens', max(len(x['ids']) for x in train+valid), flush=True)
# Loading the text-only class maps model.language_model.* weights to model.*;
# the unused vision encoder remains outside training.
quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.bfloat16)
model, load_info = Qwen3_5ForCausalLM.from_pretrained(BASE, output_loading_info=True, config=config, quantization_config=quant, device_map={'':0}, dtype=torch.bfloat16, attn_implementation='sdpa', local_files_only=True)
if load_info.get('missing_keys') or load_info.get('unexpected_keys') or load_info.get('mismatched_keys'):
    raise RuntimeError('Base weights did not map exactly: '+str(load_info))
model.config.use_cache = False
model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True, gradient_checkpointing_kwargs={'use_reentrant':False})
if args.initial_adapter:
    model = PeftModel.from_pretrained(model, str(args.initial_adapter.resolve()), is_trainable=True)
else:
    model = get_peft_model(model, LoraConfig(r=8, lora_alpha=16, lora_dropout=0.05, target_modules=['q_proj','v_proj','in_proj_qkv','out_proj'], task_type='CAUSAL_LM', bias='none'))
model.print_trainable_parameters()
base_model = model.get_base_model()
base_model.model.embed_tokens.to(torch.bfloat16)
base_model.tie_weights()

def loss_for(item, backward=False):
    ids = torch.tensor([item['ids']], dtype=torch.long, device='cuda')
    hidden = base_model.model(input_ids=ids, use_cache=False).last_hidden_state[0]
    first = item['start']-1
    states, labels = hidden[first:-1], ids[0, first+1:]
    total = len(labels)
    # Checkpoint the vocabulary projection, avoiding a giant fp32 T x vocab tensor.
    def chunk_loss(h, y):
        logits = base_model.lm_head(h.to(base_model.lm_head.weight.dtype))
        return F.cross_entropy(logits.float(), y, reduction='sum')
    loss = sum(checkpoint(chunk_loss, states[i:i+128], labels[i:i+128], use_reentrant=False) for i in range(0,total,128)) / total
    return loss

def evaluate():
    model.eval()
    values=[]
    with torch.no_grad():
        for item in valid:
            value=float(loss_for(item));values.append({'id':item['id'],'nll':value})
            print('EVAL',item['id'],round(value,4),flush=True)
    return {'mean_nll':sum(v['nll'] for v in values)/len(values),'nodes':values}

def probes(name):
    model.eval(); outputs=[]
    for item in valid+train:
        if item['id'] not in PROBES: continue
        text=tok.apply_chat_template(item['prompt_messages'],tokenize=False,add_generation_prompt=True,enable_thinking=False)
        batch=tok(text,return_tensors='pt').to('cuda')
        with torch.inference_mode():
            result=model.generate(**batch,max_new_tokens=args.probe_max_tokens,max_time=args.probe_max_seconds,do_sample=False,use_cache=True,pad_token_id=tok.eos_token_id)
        output=tok.decode(result[0,batch.input_ids.shape[1]:],skip_special_tokens=True)
        outputs.append({'id':item['id'],'split':'validation' if item['id'] in {x['id'] for x in valid} else 'train','content':output,'tokens':int(result.shape[1]-batch.input_ids.shape[1]),'truncated':int(result[0,-1])!=tok.eos_token_id})
        (ROOT/(name+'-generations.json')).write_text(json.dumps(outputs,ensure_ascii=False,indent=2),encoding='utf-8')
        print('PROBE',name,item['id'],len(output),flush=True)
    (ROOT/(name+'-generations.json')).write_text(json.dumps(outputs,ensure_ascii=False,indent=2),encoding='utf-8')

baseline = evaluate()
(ROOT/'baseline-evaluation.json').write_text(json.dumps(baseline,indent=2),encoding='utf-8')
probes('baseline')
initial = {n:p.detach().cpu().clone() for n,p in model.named_parameters() if p.requires_grad}
optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=5e-5, weight_decay=0.01)
history=[];start=time.time();step=0
for epoch in range(args.epochs):
    order=train.copy();random.shuffle(order);model.train();optimizer.zero_grad(set_to_none=True)
    for i,item in enumerate(order):
        value=loss_for(item)
        group_size=min(4,len(order)-(i//4)*4)
        (value/group_size).backward()
        row={'epoch':epoch+1,'node':item['id'],'loss':float(value.detach()),'seconds':round(time.time()-start,1)}
        history.append(row);print('TRAIN',json.dumps(row),flush=True)
        if (i+1)%4==0 or i+1==len(order):
            torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad],1.0)
            optimizer.step();optimizer.zero_grad(set_to_none=True);step+=1
    model.save_pretrained(ROOT/f'adapter-epoch-{epoch+1}',safe_serialization=True)
    metrics=evaluate()
    (ROOT/f'epoch-{epoch+1}-evaluation.json').write_text(json.dumps(metrics,indent=2),encoding='utf-8')
    if epoch==0 or metrics['mean_nll']<best:
        best=metrics['mean_nll'];best_epoch=epoch+1;model.save_pretrained(OUT,safe_serialization=True);tok.save_pretrained(OUT)

changed={n:float((p.detach().cpu()-initial[n]).abs().max()) for n,p in model.named_parameters() if n in initial}
report={'base':'Qwen/Qwen3.5-4B','method':'NF4 QLoRA continuation' if args.initial_adapter else 'NF4 QLoRA supervised fine-tuning','train_nodes':len(train),'validation_nodes':len(valid),'epochs':args.epochs,'optimizer_steps':step,'baseline_nll':baseline['mean_nll'],'best_validation_nll':best,'best_epoch':best_epoch,'changed_tensors':sum(v>0 for v in changed.values()),'max_weight_delta':max(changed.values()),'history':history,'note':'Assistant-reviewed validation; NLL improvement is not proof of factual correctness or cross-course generalization.'}
(ROOT/'training-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
model.load_adapter(OUT,adapter_name='selected')
model.set_adapter('selected')
probes('updated')
print('TRAINING COMPLETE',json.dumps({k:v for k,v in report.items() if k!='history'}),flush=True)
