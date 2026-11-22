# 本地切片模型微调

这套脚本使用已审核的切片正文进行 QLoRA 监督微调，保存独立适配器，保留原始模型。模型仍需接收对应教材片段；训练不会把任意一本教材完整装进模型，也不等同于已经实现自动章节检索。

教材、数据集、模型权重和运行记录放在被忽略的 `local-model/` 下，不提交到 GitHub。

## 环境

使用独立 Python 环境。先按本机显卡和驱动安装 GPU 版 PyTorch，再安装训练依赖。脚本会拒绝意外使用 CPU 进行训练。

```powershell
python -m venv local-model/train-env
local-model/train-env/Scripts/python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cu126
local-model/train-env/Scripts/python.exe -m pip install -r scripts/local-model-requirements.txt
```

下载官方 `Qwen/Qwen3.5-4B` 的 Transformers 权重和 tokenizer，核对来源与校验值。现有 Ollama GGUF 文件不能直接作为本脚本的训练权重。

仅训练文本时，可先提取原始文本权重；这一步保留张量数值，排除未使用的视觉编码器：

```powershell
local-model/train-env/Scripts/python.exe scripts/prepare-qwen35-text.py --source local-model/train-base/Qwen3.5-4B --output local-model/train-base/Qwen3.5-4B-text
```

## 数据

数据目录中准备 `train.jsonl`、`validation.jsonl`，每行结构如下，内容替换为本地已审核材料：

```json
{"id":"node-id","path":["课程","章节","知识点"],"source_pages":[1],"messages":[{"role":"system","content":"仅依据教材生成切片正文。"},{"role":"user","content":"完整知识路径：课程 / 章节 / 知识点\n教材候选原文：\n[教材原文]"},{"role":"assistant","content":"[审核后的正文]"}]}
```

按章节或教材页隔离训练和验证数据，排除重复节点、空答案和对应关系尚不清楚的样本。错误初稿可另外保存为纠错记录，本脚本只对审核后的正文计算监督损失，不执行 DPO 或强化学习。助手审核样本仍需学科人员复核。

## 训练和检查

```powershell
local-model/train-env/Scripts/python.exe scripts/train-local-slicer.py --dataset-dir local-model/training-run --base-model-dir local-model/train-base/Qwen3.5-4B-text --epochs 2
```

可用 `--probe-ids id1,id2` 指定对照节点，保存训练前后的实际生成结果，并标注它们属于训练集还是验证集。`--probe-max-tokens` 和 `--probe-max-seconds` 控制检查的长度和时限；标为截断的结果不能作为完整切片验收。脚本先测基线，再逐轮训练和验证，分别保存每轮适配器，并按验证损失选择输出到 `adapter/`。`training-report.json` 记录验证损失、优化步数和权重变化。

验证损失下降不能证明内容完全正确。还应对照教材检查实际生成中的概念、条件、否定词、分类及遗漏，并检查骨架生成器回填和 Word 导出。仅在同一门课程评估时，不能据此声称已获得跨课程能力。验证未改善的适配器应保留为实验产物，继续使用原模型。

## 通过本机接口使用适配器

Windows 下使用 Transformers 参考内核逐字生成可能较慢。可安装当前官方 [llama.cpp](https://github.com/ggml-org/llama.cpp/releases) 的转换工具及适合本机 GPU 的运行时，将适配器转换为 GGUF：

```powershell
local-model/train-env/Scripts/python.exe path/to/llama.cpp/convert_lora_to_gguf.py --base local-model/train-base/Qwen3.5-4B-text --outfile local-model/training-run/slicer-lora.gguf --outtype f32 local-model/training-run/adapter
```

使用与训练基座对应的 GGUF，核对架构、张量名称、形状及注意力头排列。先运行 `llama-server --list-devices`，再填写实际设备名；下面的 `Vulkan1` 为示例：

```powershell
python scripts/serve-local-slicer-native.py --llama-server path/to/llama-server.exe --base-gguf local-model/base.gguf --lora-gguf local-model/training-run/slicer-lora.gguf --device Vulkan1
```

也可使用 Transformers 参考服务：

```powershell
local-model/train-env/Scripts/python.exe scripts/serve-local-slicer.py --base-model-dir local-model/train-base/Qwen3.5-4B-text --adapter-dir local-model/training-run/adapter
```

在工具的 API 配置中填入完整接口地址 `http://127.0.0.1:11436/v1/chat/completions`，模型 ID 为 `course-slice-qwen35-4b-v1`，本机无密钥服务的 API Key 可留空。页面支持本机回环地址的 HTTP，远程服务继续使用 HTTPS。上述服务只监听本机，保留 Ollama 原模型接口。
