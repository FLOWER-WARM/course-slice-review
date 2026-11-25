# 工作区地图

> 面向所有 agent 与维护者。行号与提交基于 `main` 的 `e88902d`（2026-11-24）。
> 动手改代码前先读本文件，再读 [agent 交接说明](agent-handoff.md)。

## 这个工具做什么

把知识图谱、教材、教师课件和已有草稿整理成可编辑的「知识切片」，并按固定六字段模板导出 Word 或 Markdown。

全流程无构建步骤：两个 `.html` 就是成品页面，直接用浏览器打开即可；`server.mjs` 只是为了提供默认 DeepSeek 接口转发和 Word 原生导出。

## 三种运行方式

| 方式 | 命令 | 差异 |
| --- | --- | --- |
| 直接开文件 | 双击 `course-slice-review.html` | AI 生成用浏览器直连（需服务商允许跨域）；Word 用 CDN 上的 pandoc-wasm |
| 本机服务 | `npm ci` 后 `node server.mjs`，打开 `http://127.0.0.1:3000` | 页面注入 `slice-server-mode` 标记：默认 DeepSeek 接口走 `/api/generate`，Word 导出走 `/api/export-word`（用本地 `pandoc-wasm`） |
| 本机模型 | 见 [本地切片模型微调](local-model-training.md) | 接口地址填 `http://127.0.0.1:<port>/v1/chat/completions`，无密钥可留空 |

`PORT` 环境变量可改端口，`server.mjs` 只接受 `127.0.0.1`/`localhost` 的 Host 头与同源 Origin。

## 目录与文件

| 路径 | 规模 | 作用 | 入库 |
| --- | --- | --- | --- |
| `course-slice-review.html` | 4871 行 | **主页面**：图谱导入、卡片编辑、教材/课件解析、API 生成、PDF 框选、导出 | 是 |
| `course-slice-prompt-demo.html` | 3762 行 | 提示词版页面：只有提示词 + 导入 + 导出，**没有**教材/API 生成 | 是 |
| `server.mjs` | 124 行 | 本机服务：发页面、转发 DeepSeek、Word 导出 | 是 |
| `word-export.mjs` | 61 行 | 服务端 html→docx（pandoc-wasm），处理分页与代码样式 | 是 |
| `scripts/*.mjs` | 7 个 | PPTX 读取、Word 样式两个 headless-Edge 回归脚本，其余为本地模型流水线 | 是 |
| `scripts/*.py` | 4 个 | QLoRA 训练、数据准备、本机推理服务 | 是 |
| `docs/` | — | 本文件、交接说明、本地模型说明 | 是 |
| `local-model/` | ~30 GB | 教材、训练样本、权重、Ollama、llama.cpp、同步用 clone、测试产物 | **否**（.gitignore） |
| `node_modules/` | 56 MB | 仅 `pandoc-wasm` 及其依赖 | **否** |
| `.env` | 93 B | `SLICE_API_*` 三个键，**当前代码没有读取**（只读 `PORT`），含真实密钥，勿提交 | **否** |

## 两条页面的关系（改代码前必看）

两份 HTML 是「同源双份」：约 3000 行逻辑逐字重复（图谱解析、卡片、导入、Word/Markdown 导出、公式转换、提示词模板）。

- 状态各自独立：review 用 `skel-tool-state-v1`，demo 用 `skel-tool-prompt-demo-state-v1`，主题键也不同，互不覆盖。
- 改公共逻辑（导出、导入、提示词、公式）必须判断是否两处都改；只改一处时在提交信息里写明原因，避免下次同步时打架。
- `data-page-node-id` 属性来自此前的可视化编辑工具，是纯标记，不要手工改动或批量删除。

## 数据流

### 1. 图谱 → 骨架表 → 切片卡片

- 入口：上传 `.xlsx/.xls/.csv`（SheetJS）或粘贴 TSV/CSV。
- 表头识别：一行里出现 ≥2 个 `根节点` / `N级节点` / `N级知识点` 才认定为层级表头，其余列（知识说明、节点 ID、思政元素等雨课堂导出列）被剔除。
- 空白单元格按 Excel 合并单元格处理：继承上方最近一行的同列值（`computePaths`）。
- 纯数字长 ID 列（如 `9438287`）不算层级。
- **只有叶子行可勾选**；父节点行置灰。`buildCards` 再过滤一次层级不足两行的行。
- 卡片字段：`title` = 最末级节点；`cat` = 根/二级；`kp` = 二级…最末级用 `/` 连接；`src` = 页面「来源默认」输入框。

### 2. 内容编辑（contenteditable，非 Markdown 源码）

- 「格式」不是手填的真相：`syncFmtFromContent` 按内容实际元素推导 `文本`、`文本/图片`、`文本/表格/公式/代码` 等（顺序固定，`/` 连接）。空内容回落为 `文本`。
- 粘贴路径会清洗格式、识别代码语言（12 种 + 伪代码）、提取 OMML/MathML 公式为 LaTeX、给图片/表格自动补两行注释。

### 3. 教材/课件 → 选材 → 单切片生成

- 可添加 PDF（需可提取文字）、DOCX、PPTX、TXT、Markdown；PPTX 读逐页文字、表格、备注。
- 选材优先级（`selectSliceMaterials`）：
  1. PPTX 按小节编号匹配（`scopePptxBooks` + `findPptxSection`），无编号课件按文件名/模块路径限定范围；
  2. 教材标题定位（`findTextbookSection`：按 `第X章`/`一、`/`（一）`/`1.` 判定标题级别，向上比对知识路径）；
  3. 兜底关键词打分：850 字切块 + 标题/祖先词 + 二元组，取前 3 块并带相邻块。
- 每片单独请求，系统提示词 = 提示词模板 + 图片索引（`[[FIG:图片ID]]`）/ 课件规则 / 语言规则。
- 校验：模型输出必须只有一块、标题与清单逐字一致、正文非空；语言与教材不符时**重试一次**，仍不符则丢弃并记入问题列表。
- 界面显示实际发送的教材字符数与原全量方式的对照、以及 token 用量。

### 4. 导入回填（把外部 AI 的成品塞回卡片）

- `htmlToBlocks` 按标题切块（支持 `#`~`######`、Word 标题样式、被标题样式吞掉 `#` 的编号标题）。
- 匹配用 `normalizeKey`：去反斜杠转义、空白、全角→半角、标点、大小写；先精确匹配标题，再匹配知识点末级，再做包含关系。
- 多个候选、标题重复、文档内重复标题一律**不自动填**，进报告等人工选择。
- 可撤销一次填充（`importBackup`），前提是这些切片之后没被改动。

### 5. 导出

Word（`exportWordSlices`）：

1. 每片生成 `<h1>标题</h1><h2>格式</h2><p>…` 的六字段结构，切片之间插分页 Div。
2. 预处理（`prepareWordContent`）：`$…$`/`$$…$$` → `\[…\]`/`\(…\)`、代码行转 `custom-style="Source Code"`、图注两行拆行、公式 span 边界修复。
3. pandoc-wasm `html+tex_math_single_backslash → json → docx`。
4. 后处理（`formatNativeWord`）：A4 页边距、正文段落统一 `Normal` 样式、表格全边框、`SourceCode` 样式（Cambria 11pt）、分页。
5. 统计导出的 `<m:oMath>` 数量，与公式数对不上时提示仍有未转换的 LaTeX。

Markdown：内容 HTML → md，图片内嵌 data URI，公式保留 LaTeX，可选附带四行字段。

## 模板与内容不变量

1. 六字段顺序固定：`标题`(h1) → 格式 → 分类 → 知识点 → 来源 → 内容(h2 分节)。
2. `格式` 取值来自内容推导，顺序：文本 → 图片 → 表格 → 公式 → 代码。
3. 公式一律 LaTeX：行内 `$…$`，独立 `$$…$$`；不写【公式】占位文字，不用图片代替。
4. 图片、表格下方必须有两行注释：`【图片标题】`/`【图片描述】`、`【表格标题】`/`【表格描述】`。
5. 代码用 ``` 语言围栏，逐字照抄；Word 中每一行是 `SourceCode` 段落，围栏行保持正文样式，缩进用全角空格保留。
6. 【内容】正文语言跟随对应教材段落（英文教材英文正文、中文教材中文正文），标题与知识路径不决定正文语言。
7. 列表编号手写（`1.` →（1）→ ① → a.），每降一级行首多一个全角空格，不依赖 Word 自动编号。
8. 切片之间分页；全部切片导出为一个文件。

## 代码位置（`course-slice-review.html`）

| 行号 | 内容 |
| --- | --- |
| 1–575 | 样式（主题变量、卡片、抽屉、打印/减弱动效） |
| 577–812 | 页面结构：导入图谱 / 卡片区 / 提示词抽屉 / 左侧四个面板（生成、图谱、规则、导出） |
| 814–816 | CDN：xlsx、jszip、mammoth（`onerror` 自移除，缺库时给出提示） |
| 818–845 | 主题与通用工具 |
| 846–1013 | 图谱解析、表头识别、叶子判定、勾选 |
| 1014–1123 | 卡片构建与渲染 |
| 1125–1650 | 内容区：粘贴清洗、图片/表格/代码/公式插入、格式推导 |
| 1652–1883 | Word 导出（六字段、预处理、pandoc、后处理） |
| 1884–2072 | Markdown 导出 |
| 2073–2365 | OMML / MathML → LaTeX |
| 2366–2634 | 纯文本 → HTML（列表、表格、标题） |
| 2635–2807 | HTML → 切片块（`htmlToBlocks`、`normalizeKey`） |
| 2808–3135 | 导入回填、预览报告、撤销、清空 |
| 3149–3350 | 提示词模板（`PROMPT_LINES`/`PROMPT_CHECK`）与抽屉 |
| 3351–3418 | 折叠状态、localStorage 持久化（`saveState`/`restoreState`） |
| 3419–3739 | 教材/课件读取（PDF、DOCX、PPTX、TXT） |
| 3740–3984 | 教材列表渲染、图号匹配与绑定 |
| 3985–4118 | 教材标题定位、按切片选材 |
| 4120–4258 | PDF 页面框选插图 |
| 4259–4444 | API 配置校验、单切片请求、语言重试、批量回填 |
| 4446–4449 | 启动恢复 |
| 4451–4871 | 「墨池」背景流体动画（与业务无关，可整体忽略） |

`course-slice-prompt-demo.html` 行号不同，定位请按函数名搜索。

## 服务端

`server.mjs`：

- `GET /`、`GET /course-slice-review.html`：返回注入了 server-mode 标记的页面。
- `POST /api/generate`：只转发 `https://api.deepseek.com/chat/completions`；要求同源 Origin、JSON、`Bearer` 密钥；请求体上限 1 MB，超时 90 s；返回正文里出现的密钥会被替换成 `[已隐藏]`。
- `POST /api/export-word`：接收 `text/html`（上限 32 MB），串行排队调用 `word-export.mjs`。
- 其他路径一律 404 JSON；Host 头不是本机地址直接 403。

`word-export.mjs`：pandoc-wasm 常驻实例 + 串行队列，把 `div.slice-word-page-break` 换成 Word 分页，把 `custom-style="Source Code"` 的段落内 `Code` 还原为纯文本。

## 验证方式

```powershell
node --check server.mjs
node --check word-export.mjs

# 服务冒烟（预期：GET 200 且含 slice-server-mode；POST /api/generate 返回 401）
node server.mjs
```

浏览器回归（需要本机 Edge 与联网加载 CDN）：

```powershell
node scripts/test-pptx-source.mjs                       # 虚拟 PPTX → 切片选材
node scripts/test-pptx-source.mjs http://127.0.0.1:3000 # 服务模式同一检查
node scripts/test-word-body-style.mjs                   # Word 样式/Normal/页边距/表格边框
```

脚本用 headless Edge + CDP 驱动真实页面，产物写到 `local-model/style-regression/`（不入库）。

2026-11-25 实测（完全权限）：`test-pptx-source.mjs` 11 项检查通过，`test-word-body-style.mjs` 输出 `{"label":"full","passed":true,"paragraphs":17,"math":true}`。受限沙箱里会因 Edge 取不到 CDN 而 `Runtime.evaluate timed out`。

## 已知问题与风险

1. **单文件体量**：主页面 4871 行；两份页面重复约 3000 行，改动容易漏同步。
2. **CDN 依赖**：xlsx / jszip / mammoth / pandoc-wasm 均从 jsdelivr/unpkg 加载，离线时对应功能不可用（代码有降级提示，但无法工作）。
3. **localStorage 容量**：内容含大量 base64 图片时会超限，`saveState` 只提示一次。
4. **`.env` 是死配置**：`SLICE_API_*` 没有任何代码读取，密钥却是真的，属于潜在泄漏点。
5. **沙箱写权限**：本机 DSH 沙箱的 shell 只能写仓库根目录，写 `docs/`、`scripts/` 等子目录会被拒绝（见交接说明的「已知限制」）。
6. **公式覆盖**：MathType/OLE 与图片公式无法提取，只能手工重建。
7. **测试缺口**：导入匹配、公式转换、提示词生成没有自动化回归，只有 PPTX 与 Word 样式两个脚本。
