"""OpenAI-compatible localhost endpoint for the saved course-slice LoRA."""
import os
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TOKENIZERS_PARALLELISM']='false'
import json, threading, time, uuid
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import torch
from transformers import AutoTokenizer, AutoConfig, BitsAndBytesConfig, Qwen3_5ForCausalLM
from peft import PeftModel, prepare_model_for_kbit_training

import argparse
parser=argparse.ArgumentParser(description='Serve a local Qwen3.5 text LoRA over an OpenAI-compatible interface')
parser.add_argument('--base-model-dir',required=True,type=Path)
parser.add_argument('--adapter-dir',required=True,type=Path)
parser.add_argument('--model-name',default='course-slice-qwen35-4b-v1')
parser.add_argument('--port',type=int,default=11436)
args=parser.parse_args()
BASE=args.base_model_dir.resolve()
ADAPTER=args.adapter_dir.resolve()
NAME=args.model_name
lock=threading.Lock()
torch.set_num_threads(4)
tok=AutoTokenizer.from_pretrained(ADAPTER,local_files_only=True)
quant=BitsAndBytesConfig(load_in_4bit=True,bnb_4bit_quant_type='nf4',bnb_4bit_use_double_quant=True,bnb_4bit_compute_dtype=torch.bfloat16)
model=Qwen3_5ForCausalLM.from_pretrained(BASE,quantization_config=quant,device_map={'':0},dtype=torch.bfloat16,attn_implementation='sdpa',local_files_only=True)
model=prepare_model_for_kbit_training(model,use_gradient_checkpointing=False)
model.model.embed_tokens.to(torch.bfloat16)
model.tie_weights()
model=PeftModel.from_pretrained(model,ADAPTER).eval()

class Handler(BaseHTTPRequestHandler):
    def reply(self,status,data):
        payload=json.dumps(data,ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
        self.send_header('Content-Length',str(len(payload)))
        self.end_headers();self.wfile.write(payload)
    def do_OPTIONS(self): self.reply(200,{})
    def do_GET(self):
        if self.path in ['/v1/models','/models']:
            self.reply(200,{'object':'list','data':[{'id':NAME,'object':'model','owned_by':'local'}]})
        else:self.reply(200,{'status':'ready','model':NAME,'adapter':str(ADAPTER)})
    def do_POST(self):
        if self.path!='/v1/chat/completions':return self.reply(404,{'error':'Use /v1/chat/completions'})
        try:
            n=int(self.headers.get('Content-Length','0'))
            if n>4_000_000:return self.reply(413,{'error':'Request too large'})
            req=json.loads(self.rfile.read(n))
            if req.get('stream'):return self.reply(400,{'error':'Set stream=false'})
            if req.get('model',NAME)!=NAME:return self.reply(400,{'error':'Unknown model','available':NAME})
            text=tok.apply_chat_template(req['messages'],tokenize=False,add_generation_prompt=True,enable_thinking=False)
            batch=tok(text,return_tensors='pt').to('cuda')
            size=batch.input_ids.shape[1]
            maximum=min(int(req.get('max_tokens',2000)),3000)
            if size+maximum>12000:return self.reply(400,{'error':'Context too long; reduce textbook candidate extract','input_tokens':size})
            with lock,torch.inference_mode():
                output=model.generate(**batch,max_new_tokens=maximum,do_sample=False,use_cache=True,pad_token_id=tok.eos_token_id)
            ids=output[0,size:];content=tok.decode(ids,skip_special_tokens=True)
            self.reply(200,{'id':'local-'+uuid.uuid4().hex,'object':'chat.completion','created':int(time.time()),'model':NAME,'choices':[{'index':0,'message':{'role':'assistant','content':content},'finish_reason':'length' if len(ids)>=maximum else 'stop'}],'usage':{'prompt_tokens':size,'completion_tokens':len(ids),'total_tokens':size+len(ids)}})
        except Exception as exc:self.reply(500,{'error':str(exc)})

print(f'Local fine-tuned model ready: http://127.0.0.1:{args.port}/v1/chat/completions',flush=True)
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
