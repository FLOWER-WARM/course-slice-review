# 知识切片制作与审核工具

将知识图谱、教材和已有草稿整理成可编辑的知识切片，并导出为 Word 或 Markdown。前端负责教材解析、图片匹配、编辑和导出，Node.js 后端负责模型请求、服务密钥和超时处理。

## 如何运行

使用 Node.js 22 或更新版本，在项目目录中执行：

```powershell
Copy-Item .env.example .env
node --env-file=.env server.mjs
```

打开 `http://127.0.0.1:3000`。使用 AI 生成前，在 `.env` 填写 `SLICE_API_MODEL` 和 `SLICE_API_KEY`，然后重启服务。默认接口为 DeepSeek，可通过 `SLICE_API_ENDPOINT` 配置 OpenAI 兼容接口。服务监听本机，浏览器只向后端提交提示词和筛选后的教材正文。

也可以直接在 Edge 或 Chrome 中打开 `course-slice-review.html`。直接打开时，AI 生成沿用页面内配置接口的方式。旧版网页的浏览器缓存和本机服务页面各自保存状态，已有切片可先从旧页面导出，再导入新页面。部分文件格式解析和 Word 导出需要联网加载页面依赖。

## 使用流程

1. 导入 Excel 或 CSV 知识图谱，选择要整理的知识点。
2. 导入 Word 或 Markdown 草稿，或在生成面板中添加教材并按知识点生成切片。
3. 在【内容】中核对正文、图片、表格和公式，再导出 Word 或 Markdown。

## 实现要点

- 教材插图按图号关联到正文。工具尝试从 DOCX 和文字版 PDF 提取并匹配插图，遇到歧义时可在页面选择候选，复杂 PDF 可手动框选。
- API 生成根据切片标题和图谱路径筛选教材段落，界面显示实际发送的原文字符数以及接口返回的 token 用量。
- Word 导出按切片模板组织字段，并保留正文中的图片和表格。公式以 LaTeX 文本保留。
