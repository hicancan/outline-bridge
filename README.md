# OutlineBridge

OutlineBridge 是一个适合部署到 GitHub Pages 的纯前端工具，用来把书籍的印刷版目录页转换成 PDF 书签。

## 它解决什么问题

很多教材、电子书或扫描版 PDF 明明有目录页，但阅读器左侧没有可点击的书签。目录桥把这件事拆成一个很稳的流程：

1. 在浏览器里上传 PDF
2. 把目录页渲染成图片
3. 把图片交给任意视觉大模型
4. 把模型返回的 JSON 粘贴回页面
5. 输入一个锚点，例如 `书内第 1 页 = PDF 第 15 页`
6. 在浏览器本地生成带书签的新 PDF

全程不需要后端，原始 PDF 不会离开浏览器标签页。

## 设计思路

这个项目从一开始就按 GitHub Pages 约束设计，所以没有依赖任何服务器能力：

- UI：React 19 + Vite 8
- 样式：Tailwind CSS 4
- 类型系统：TypeScript 5.9
- PDF 渲染：pdfjs-dist
- JSON 校验：Zod
- 书签写入：Pyodide + pypdf（运行在 Web Worker 中）

这里故意没有绑定某个特定模型。Gemini、GPT、Qwen、Claude 或其他视觉模型都可以，只要它能稳定返回约定格式的 JSON。

## 技术栈选择

当前项目采用：

- React 19.x
- Vite 8.x
- Tailwind CSS 4.x
- TypeScript 5.9.x

TypeScript 没有强行升到 6.x，因为当前稳定版 `typescript-eslint` 仍主要兼容 `< 6.0.0`。这里优先选的是稳定组合，而不是单纯追求最大版本号。

## 本地开发

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run lint
npm run typecheck
npm run build
npm run check
```

## GitHub Pages 部署

仓库已经包含 GitHub Pages 工作流：

- `.github/workflows/deploy.yml`

使用方式：

1. 把仓库推到 GitHub
2. 在仓库设置里启用 GitHub Pages，并选择 GitHub Actions
3. 推送到 `main`

默认推荐自定义域名：

- `outline.hicancan.top`

如果你启用这个域名，需要同时完成：

1. 在 DNS 里把 `outline.hicancan.top` 指向 GitHub Pages
2. 保证构建产物里存在 `CNAME`

## 目录 JSON 格式

页面支持直接粘贴 Markdown 代码围栏，内部会自动剥离围栏后再校验。

```json
{
  "entries": [
    {
      "order": 1,
      "toc_image_index": 1,
      "level": 1,
      "title": "第1章 程序设计：综述",
      "page_label": "1",
      "uncertain": false
    }
  ],
  "uncertain_entries": []
}
```

## 浏览器端限制

- 第一次生成 PDF 会慢一些，因为需要按需下载 Pyodide 并安装 `pypdf`
- 超大 PDF 会占用较多浏览器内存
- 网站本身不直接调用视觉模型 API，也不会托管你的密钥
