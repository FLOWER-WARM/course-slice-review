# Agent 交接说明

> 任何 agent 接手本工作区前先读这一页，再读 [工作区地图](workspace-map.md)。
> 每次交付后在本文件末尾的「交接记录」追加一行。

## 一、现状快照（2026-11-25）

| 项 | 状态 |
| --- | --- |
| 远端仓库 | `https://github.com/FLOWER-WARM/course-slice-review`（公开，默认分支 `main`） |
| 远端最新提交 | `e88902d` *Retry slice generation when body language conflicts with source*（2026-11-24 21:25 +08:00） |
| 本地工作区 | `E:\雨课堂\切片生成`，**根目录即 git 仓库**，`origin` 指向上面这个远端 |
| 本地基线 | 工作树 = `e88902d`；`git status` 应为干净 |
| 未提交改动 | 无 |
| 本地数据 | `local-model/`（教材、训练样本、LoRA 权重、Ollama、llama.cpp、同步 clone），约 30 GB，全部不入库 |

历史：工作区在 2026-11-22 前后有过 `.git`，但在交接时已不存在；本次用 codex 留下的同步 clone 把 `.git` 接回根目录（`HEAD` 不变，工作树内容逐字节一致）。

## 二、之前是谁做的、做了什么

2026-11-13 至 2026-11-24，Codex 在这个目录完成主页面、Word/Markdown 导出、公式转换、导入回填、教师 PPTX 选材、本地 QLoRA 训练与接入，共至少 12 次提交。最近几次：

| 提交 | 内容 |
| --- | --- |
| `e88902d` | 正文语言与教材冲突时重试一次 |
| `2732544` | 正文语言跟随教材原文段落 |
| `412cef8` | 全量、演示、服务三处导出统一 Word Normal 正文样式 |
| `2687280` | 支持教师 PPTX（备注、模块范围选材） |
| `904ef49` | 本地 QLoRA 训练与本机回环模型接口 |

Codex 的同步方式与本次不同：它把仓库 clone 到 `local-model/github-sync-v3/`，把源码复制进去、提交、推送，再核对远端。**从现在起不需要这样做了**——根目录就是仓库，直接在这里提交推送。

`local-model/` 里还留着 Codex 的本地模型成果（`training-v2/`、`training-v3/`、`初等数论测试/`、`启动切片微调模型-v3.cmd` 等），属于个人数据，不要提交、不要清理。

## 三、本次（2026-11-25）做了什么

1. **修复 Windows 文件权限**：DSH 沙箱在该目录启动时报 `grantWrite` 失败（目录缺少 `WRITE_OWNER`）。用诊断脚本给当前账户补了完全控制权限并验证，备份与恢复脚本在 `E:\雨课堂\acl-recovery\`。
2. **接入 git**：把 `local-model/github-sync-v3/.git` 复制为根目录 `.git`，`origin` 保持 GitHub 地址，`HEAD` = `e88902d`，工作树内容与远端一致（`git status` 干净）。
3. **新增协作文档**：`docs/workspace-map.md`（代码地图与不变量）、本文件（交接与协作协议），并扩充 `AGENTS.md`。

没有改动任何业务代码。

## 四、多 agent 协作协议

### 4.1 谁改什么

| 范围 | 文件 | 建议由一个 agent 独占 |
| --- | --- | --- |
| 主页面 | `course-slice-review.html` | 是（不同 agent 同时改必冲突） |
| 提示词版页面 | `course-slice-prompt-demo.html` | 是 |
| 服务端 | `server.mjs`、`word-export.mjs` | 是 |
| 回归脚本 | `scripts/*.mjs` | 可并行，注意共用 Edge/CDP 端口 |
| 本地模型线 | `scripts/*.py`、`local-model/` | 隔离，不碰源码 |
| 文档 | `README.md`、`docs/` | 可并行 |

同一时间只安排一个 agent 改同一个文件。任务范围重叠时，先拆成「先改结构、再改文案」两轮，而不是同时动手。

### 4.2 写入规则

- 动手前先 `git status`；出现不是自己的未提交改动，停下确认，不要覆盖。
- 用 `write`/`edit` 工具改文件（见 4.6 的沙箱限制）。
- 两份 HTML 是「同源双份」，公共逻辑（导出、导入、公式、提示词）改动要么两处都改，要么只改 review 并在提交信息里写明理由。
- 不手工调整 `data-page-node-id` 属性；不引入构建步骤或框架——页面必须保持双击可运行。

### 4.3 验证门禁

改完必须自测，至少在最终回复里说明做了哪些：

| 改动 | 最低验证 |
| --- | --- |
| `*.mjs` | `node --check <file>` |
| 页面脚本/样式 | 打开页面：导入一份小图谱 → 生成卡片 → 填一段带公式和表格的内容 → 导出 Word 与 Markdown |
| Word 导出 | `node scripts/test-word-body-style.mjs` |
| PPTX 选材 | `node scripts/test-pptx-source.mjs`（服务模式加 `http://127.0.0.1:3000`） |
| 服务端 | 启动后 `GET /` 返回 200 且含 `slice-server-mode`；`POST /api/generate` 无密钥返回 401 |
| 文档 | 无 |

浏览器回归需要本机 Edge 和联网加载 CDN；失败时在回复里写清是脚本问题还是环境问题。

### 4.4 提交与同步

```powershell
git status --short          # 只应出现自己改的文件
git diff --stat
git add <自己的文件>         # 不要 git add -A 以外的顺手提交
git commit -m "一句话说明改了什么、为什么"
git push origin main
```

- 提交信息用中文一句话，动词开头（例：`修正 Word 表格边框在合并单元格上重复`）。
- 推送后核对远端：`git ls-remote origin main` 或看提交页，确认 SHA 与本地一致。
- 用户要求「优化工具」时，按 `AGENTS.md` 必须同步远端并在最终回复给出提交链接；连不上就在回复里说明远端状态。

### 4.5 禁止

- 提交 `.env`、`.env.*`、`local-model/`、`node_modules/`、教材、训练样本、权重、生成的切片和个人测试数据。
- 在源码、文档、提交信息里写 API Key 或真实密钥。
- 用 `git push --force`；需要改写历史先问用户。

### 4.6 已知限制（本机 DSH 沙箱）

- **shell 只能写仓库根目录**：`docs/`、`scripts/` 等子目录会被拒绝（目录仍是「中」完整性级别，沙箱进程是「低」级别）。所以：改文件用 `write`/`edit` 工具；`git checkout -- 子目录文件`、`git stash`、`git merge` 这类会重写工作树的命令可能失败。
- **git 网络操作需要完全权限**：沙箱内 `git ls-remote/fetch/push` 会报 `schannel: AcquireCredentialsHandle failed`。推送前请用户放开一次权限，或让用户在宿主终端推送。
- 回归脚本 spawn headless Edge，产物写 `local-model/`，同理需要权限。

## 五、待办候选（按价值排序）

| 任务 | 风险 | 说明 |
| --- | --- | --- |
| 明确两份 HTML 的定位 | 中 | 选「保留一份」还是「demo 冻结为历史版本」，决定后续是否还要双写 |
| 补导入/公式/提示词的最小回归脚本 | 低 | 已有 CDP 脚本可复制；能防住最容易回归的匹配逻辑 |
| 处理 `.env` | 低 | 删除，或让 `server.mjs` 真正读取（当前只读 `PORT`） |
| README 补「服务模式 vs 直接打开」差异表 | 低 | 现在分散在正文里 |
| 评估共享逻辑抽取 | 高 | `file://` 下 ES module 受限，抽库会破坏「双击可用」，需要先定方案 |

## 六、交接记录

| 日期 | 执行者 | 改动范围 | 验证 | 提交 |
| --- | --- | --- | --- | --- |
| 2026-11-25 | DSH（接管） | 修复工作区权限；根目录接入 git（HEAD `e88902d`）；新增 `docs/workspace-map.md`、`docs/agent-handoff.md`；扩充 `AGENTS.md` | `git status` 干净；服务冒烟 GET 200 / POST 401；`node --check` 两个 `.mjs` | 见本文件所在提交 |
