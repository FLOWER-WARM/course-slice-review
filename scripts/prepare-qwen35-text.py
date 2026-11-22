"""Extract Qwen3.5 text tensors with bounded memory and byte verification."""
import argparse,hashlib,json,os,shutil,struct
from pathlib import Path
parser=argparse.ArgumentParser(description='Extract original Qwen3.5 text tensors without changing tensor bytes')
parser.add_argument('--source',required=True,type=Path)
parser.add_argument('--output',required=True,type=Path)
a=parser.parse_args();src=a.source.resolve();dst=a.output.resolve()
if src==dst:parser.error('Source and output must differ')
dst.mkdir(parents=True,exist_ok=True)
conf=json.loads((src/'config.json').read_text(encoding='utf-8'))['text_config']
conf['architectures']=['Qwen3_5ForCausalLM']
(dst/'config.json').write_text(json.dumps(conf,indent=2),encoding='utf-8')
index=json.loads((src/'model.safetensors.index.json').read_text(encoding='utf-8'))
mapping={};total=0;checks={}
for name in sorted(set(index['weight_map'].values())):
    with (src/name).open('rb') as f:
        header_size=struct.unpack('<Q',f.read(8))[0]
        original=json.loads(f.read(header_size))
        keys=sorted((k for k in original if k.startswith('model.language_model.')),key=lambda k:original[k]['data_offsets'][0])
        if not keys:continue
        header={'__metadata__':{'format':'pt'}};offset=0
        for key in keys:
            info=original[key];start,end=info['data_offsets'];length=end-start
            target_key=key.replace('model.language_model.','model.',1)
            header[target_key]={**info,'data_offsets':[offset,offset+length]}
            offset+=length;mapping[target_key]=name
        raw=json.dumps(header,separators=(',',':')).encode('utf-8')
        raw+=b' '*((-len(raw))%8)
        target=dst/name;temp=Path(str(target)+'.writing');digest=hashlib.sha256()
        with temp.open('wb') as out:
            out.write(struct.pack('<Q',len(raw)));out.write(raw)
            for key in keys:
                start,end=original[key]['data_offsets'];remaining=end-start
                f.seek(8+header_size+start)
                while remaining:
                    block=f.read(min(16*1024*1024,remaining))
                    if not block:raise IOError('Unexpected end of source tensor '+key)
                    out.write(block);digest.update(block);remaining-=len(block)
        # Verify serialized data section equals the selected original byte stream.
        copied=hashlib.sha256()
        with temp.open('rb') as verify:
            verify.seek(8+len(raw))
            while block:=verify.read(16*1024*1024):copied.update(block)
        if digest.digest()!=copied.digest():raise IOError('Tensor byte verification failed')
        os.replace(temp,target);total+=offset;checks[name]=digest.hexdigest()
        print(name,len(keys),'tensors; bytes verified',offset,flush=True)
(dst/'model.safetensors.index.json').write_text(json.dumps({'metadata':{'total_size':total},'weight_map':mapping},indent=2),encoding='utf-8')
(dst/'tensor-copy-checksums.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
for name in ['tokenizer.json','tokenizer_config.json','chat_template.jinja','merges.txt','vocab.json','generation_config.json']:
    if (src/name).exists():shutil.copyfile(src/name,dst/name)
print('Text weights preserved:',len(mapping),total,flush=True)
