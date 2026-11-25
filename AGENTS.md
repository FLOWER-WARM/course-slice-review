# 协作约定

本工作区是「知识切片制作与审核工具」：两个单文件 HTML 页面 + 一台本机 Node 服务，没有构建步骤。

开工前按顺序读：

1. `docs/workspace-map.md` —— 代码地图、模板不变量、验证命令、已知风险。
2. `docs/agent-handoff.md` —— 当前状态、多 agent 分工与交接记录。

## GitHub 同步

此项目用于简历展示，计划同步到 `FLOWER-WARM/course-slice-review`。

用户要求优化此工具时，验证修改后将同一版本同步至上述 GitHub 仓库，并检查远端提交。最终回复给出对应的提交或 PR 链接。遇到连接或权限问题时，说明远端同步状态。

提交项目源码及相关说明。教材、API 密钥、个人测试数据和生成的切片保留在本地。

工作区根目录就是 Git 仓库，`origin` 指向该仓库，默认分支 `main`。直接在这里提交并推送，不要再另建 clone；推送后用 `git ls-remote origin main` 核对远端 SHA。

## 多 agent 协作

- 同一时间只安排一个 agent 改同一个文件。`course-slice-review.html` 与 `course-slice-prompt-demo.html` 是两个独立大文件，公共逻辑（导出、导入、公式、提示词）的改动要么两处同步，要么只改一处并在提交信息里说明理由。
- 动手前先 `git status`；出现不是自己的未提交改动，先停下确认，不要覆盖。
- 只提交本任务相关的文件；提交信息用中文一句话说明改了什么、为什么。
- 交付前按 `docs/workspace-map.md` 的「验证方式」自测，并在回复里说明做了哪些验证。
- 完成并推送后，在 `docs/agent-handoff.md` 的「交接记录」追加一行。
- 不提交 `local-model/`、`node_modules/`、`.env*`、教材、训练样本、权重、生成的切片和个人测试数据。
- 页面必须保持双击即可运行：不要引入构建步骤、打包器或需要本地服务器的模块加载方式。
