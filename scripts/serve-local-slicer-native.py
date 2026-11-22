"""Run an installed llama.cpp server with a local base GGUF and trained LoRA."""
import argparse, json, subprocess, sys
from pathlib import Path

parser=argparse.ArgumentParser(description='Serve a trained local slice LoRA through llama.cpp')
parser.add_argument('--llama-server',required=True,type=Path)
parser.add_argument('--base-gguf',required=True,type=Path)
parser.add_argument('--lora-gguf',required=True,type=Path)
parser.add_argument('--device',required=True,help='A device reported by llama-server --list-devices')
parser.add_argument('--port',type=int,default=11436)
parser.add_argument('--context-size',type=int,default=16384)
parser.add_argument('--model-name',default='course-slice-qwen35-4b-v1')
args=parser.parse_args()
for path in [args.llama_server,args.base_gguf,args.lora_gguf]:
    if not path.is_file():parser.error('File not found: '+str(path))
command=[str(args.llama_server.resolve()),'--model',str(args.base_gguf.resolve()),
         '--lora',str(args.lora_gguf.resolve()),'--device',args.device,'--n-gpu-layers','99',
         '--host','127.0.0.1','--port',str(args.port),'--ctx-size',str(args.context_size),
         '--threads','4','--parallel','1','--alias',args.model_name,'--jinja',
         '--chat-template-kwargs',json.dumps({'enable_thinking':False})]
print('Starting local fine-tuned model:',args.model_name,flush=True)
process=subprocess.Popen(command,stdout=sys.stdout,stderr=sys.stderr,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
try:
    raise SystemExit(process.wait())
except KeyboardInterrupt:
    process.terminate()
    process.wait()
