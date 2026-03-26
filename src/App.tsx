import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import {
  ArrowDownToLine,
  CheckCircle2,
  Copy,
  FileCog,
  FileJson2,
  FileOutput,
  FileUp,
  ImageDown,
  LoaderCircle,
  Sparkles,
  WandSparkles,
} from 'lucide-react'

import { renderPdfPages, readPdfPageCount } from './lib/pdf'
import { parseTocPayload, resolveTocEntries } from './lib/toc'
import { PROMPT_TEMPLATE } from './prompt'
import type {
  BookmarkWorkerRequest,
  BookmarkWorkerResponse,
  ParsedTocPayload,
  RenderedPage,
  ResolvedTocEntry,
} from './types'

const DEFAULT_RANGE_START = '11'
const DEFAULT_RANGE_END = '14'
const DEFAULT_ANCHOR_BOOK_PAGE = '1'

function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null)
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null)

  const [rangeStart, setRangeStart] = useState(
    () => localStorage.getItem('outline-range-start') ?? DEFAULT_RANGE_START,
  )
  const [rangeEnd, setRangeEnd] = useState(
    () => localStorage.getItem('outline-range-end') ?? DEFAULT_RANGE_END,
  )
  const [anchorBookPage, setAnchorBookPage] = useState(
    () => localStorage.getItem('outline-anchor-book-page') ?? DEFAULT_ANCHOR_BOOK_PAGE,
  )
  const [anchorPdfPage, setAnchorPdfPage] = useState(
    () => localStorage.getItem('outline-anchor-pdf-page') ?? '',
  )
  const [jsonInput, setJsonInput] = useState(
    () => localStorage.getItem('outline-json-input') ?? '',
  )

  const [renderedPages, setRenderedPages] = useState<RenderedPage[]>([])
  const [parsedPayload, setParsedPayload] = useState<ParsedTocPayload | null>(null)
  const [resolvedEntries, setResolvedEntries] = useState<ResolvedTocEntry[]>([])

  const [renderState, setRenderState] = useState({
    loading: false,
    message: '先上传 PDF，再填写目录页范围。',
  })
  const [jsonState, setJsonState] = useState({
    ok: false,
    message: '把视觉模型返回的 JSON 粘贴到这里。',
  })
  const [buildState, setBuildState] = useState({
    loading: false,
    message: '书签生成完全在浏览器里完成，不依赖后端。',
  })
  const [outputFile, setOutputFile] = useState<{
    fileName: string
    objectUrl: string
  } | null>(null)

  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    localStorage.setItem('outline-range-start', rangeStart)
  }, [rangeStart])

  useEffect(() => {
    localStorage.setItem('outline-range-end', rangeEnd)
  }, [rangeEnd])

  useEffect(() => {
    localStorage.setItem('outline-anchor-book-page', anchorBookPage)
  }, [anchorBookPage])

  useEffect(() => {
    localStorage.setItem('outline-anchor-pdf-page', anchorPdfPage)
  }, [anchorPdfPage])

  useEffect(() => {
    localStorage.setItem('outline-json-input', jsonInput)
  }, [jsonInput])

  useEffect(() => {
    if (!jsonInput.trim()) {
      setParsedPayload(null)
      setResolvedEntries([])
      setJsonState({
        ok: false,
        message: '把视觉模型返回的 JSON 粘贴到这里。',
      })
      return
    }

    startTransition(() => {
      try {
        const result = parseTocPayload(jsonInput)
        setParsedPayload(result)
        setJsonState({
          ok: true,
          message: `已读取 ${result.entries.length} 条目录，另有 ${result.uncertainEntries.length} 条不确定项保留在主目录之外。`,
        })
      } catch (error) {
        console.error(error)
        setParsedPayload(null)
        setResolvedEntries([])
        setJsonState({
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : '粘贴的内容不是有效的目录 JSON。',
        })
      }
    })
  }, [jsonInput])

  useEffect(() => {
    if (!parsedPayload) {
      setResolvedEntries([])
      return
    }

    const mapping = resolveTocEntries(
      parsedPayload,
      anchorBookPage,
      anchorPdfPage,
      pdfPageCount ?? undefined,
    )
    setResolvedEntries(mapping.entries)

    if (mapping.errors.length > 0) {
      setBuildState({
        loading: false,
        message: mapping.errors[0],
      })
      return
    }

    const skippedCount = parsedPayload.entries.length - mapping.entries.length
    setBuildState({
      loading: false,
      message:
        skippedCount > 0
          ? `已解析 ${mapping.entries.length} 条目录，另有 ${skippedCount} 条因页码无效或超出 PDF 范围被跳过。`
          : `已解析 ${mapping.entries.length} 条目录，可以直接生成带书签的 PDF。`,
    })
  }, [anchorBookPage, anchorPdfPage, parsedPayload, pdfPageCount])

  useEffect(() => {
    const activeWorker = workerRef.current
    return () => {
      for (const page of renderedPages) {
        URL.revokeObjectURL(page.objectUrl)
      }
      if (outputFile) {
        URL.revokeObjectURL(outputFile.objectUrl)
      }
      activeWorker?.terminate()
    }
  }, [outputFile, renderedPages])

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    resetRenderedPages()
    resetOutputFile()
    setPdfFile(file)
    setRenderState({
      loading: true,
      message: '正在读取 PDF 并统计页数…',
    })

    const nextBytes = await file.arrayBuffer()
    setPdfBytes(nextBytes)

    try {
      const pageCount = await readPdfPageCount(nextBytes)
      setPdfPageCount(pageCount)
      setRenderState({
        loading: false,
        message: `PDF 读取完成，共 ${pageCount} 页。`,
      })
    } catch (error) {
      console.error(error)
      setPdfPageCount(null)
      setRenderState({
        loading: false,
        message: '浏览器里无法读取这个 PDF。',
      })
    }
  }

  const handleRenderTocPages = async () => {
    if (!pdfBytes) {
      setRenderState({
        loading: false,
        message: '请先上传 PDF。',
      })
      return
    }

    const start = Number(rangeStart)
    const end = Number(rangeEnd)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
      setRenderState({
        loading: false,
        message: '请填写有效的目录页范围，例如 11 到 14。',
      })
      return
    }

    if (pdfPageCount && end > pdfPageCount) {
      setRenderState({
        loading: false,
        message: `这个 PDF 只有 ${pdfPageCount} 页。`,
      })
      return
    }

    resetRenderedPages()
    setRenderState({
      loading: true,
      message: '正在把目录页渲染成图片…',
    })

    try {
      const nextPages = await renderPdfPages(pdfBytes, start, end)
      setRenderedPages(nextPages)
      setRenderState({
        loading: false,
        message: `已生成 ${nextPages.length} 张目录页图片，可以下载 PNG 或发给视觉模型。`,
      })
    } catch (error) {
      console.error(error)
      setRenderState({
        loading: false,
        message: '目录页渲染失败，可以试试别的 PDF 或缩小页范围。',
      })
    }
  }

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(PROMPT_TEMPLATE)
      setJsonState({
        ok: jsonState.ok,
        message: '提取提示词已复制到剪贴板。',
      })
    } catch (error) {
      console.error(error)
      setJsonState({
        ok: jsonState.ok,
        message: '剪贴板访问失败，你也可以手动复制下面的提示词。',
      })
    }
  }

  const handleDownloadImages = async () => {
    if (renderedPages.length === 0) {
      return
    }

    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    for (const page of renderedPages) {
      zip.file(
        `toc-page-${String(page.pdfPageNumber).padStart(3, '0')}.png`,
        page.blob,
      )
    }

    const archive = await zip.generateAsync({ type: 'blob' })
    const downloadUrl = URL.createObjectURL(archive)
    triggerDownload(downloadUrl, '目录页图片.zip')
    URL.revokeObjectURL(downloadUrl)
  }

  const handleGeneratePdf = async () => {
    if (!pdfBytes || !pdfFile) {
      setBuildState({
        loading: false,
        message: '请先上传 PDF。',
      })
      return
    }

    if (resolvedEntries.length === 0) {
      setBuildState({
        loading: false,
        message: '至少要先解析出一条有效目录，才能生成书签 PDF。',
      })
      return
    }

    resetOutputFile()
    setBuildState({
      loading: true,
      message: '正在启动浏览器内的书签引擎…',
    })

    try {
      const worker = getWorker(workerRef)
      const resultBuffer = await runBookmarkWorker(
        worker,
        {
          type: 'build',
          pdfBytes: pdfBytes.slice(0),
          entries: resolvedEntries,
        },
        (message) => {
          setBuildState({
            loading: true,
            message,
          })
        },
      )

      const objectUrl = URL.createObjectURL(
        new Blob([resultBuffer], { type: 'application/pdf' }),
      )
      const fileName = buildOutputName(pdfFile.name)
      setOutputFile({
        fileName,
        objectUrl,
      })
      setBuildState({
        loading: false,
        message: '已生成完成，下载新 PDF 后检查阅读器侧边栏书签即可。',
      })
    } catch (error) {
      console.error(error)
      setBuildState({
        loading: false,
        message:
          error instanceof Error ? error.message : '浏览器内的书签生成失败。',
      })
    }
  }

  const tocStats = parsedPayload
    ? {
        entryCount: parsedPayload.entries.length,
        uncertainCount: parsedPayload.uncertainEntries.length,
      }
    : null

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_38%),radial-gradient(circle_at_80%_10%,_rgba(249,115,22,0.14),_transparent_34%),linear-gradient(180deg,#f7f4ea_0%,#f4efe2_48%,#f1ede4_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="grid gap-6 rounded-[2rem] border border-slate-900/10 bg-white/80 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-8 lg:grid-cols-[1.45fr_0.9fr]">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-900/10 bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-white">
              <Sparkles className="h-3.5 w-3.5" />
              GitHub Pages 就绪
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-700">
                目录桥
              </p>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                用任意视觉大模型提取目录，再在浏览器里生成带书签的 PDF。
              </h1>
              <p className="max-w-3xl text-base leading-7 text-slate-700 sm:text-lg">
                上传 PDF，把目录页导出成图片，交给任意多模态模型返回 JSON，再在本地浏览器里写回 PDF 书签，全程不需要后端。
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-slate-700">
              <StatBadge label="前端" value="React 19 + Vite 8" />
              <StatBadge label="样式" value="Tailwind CSS 4" />
              <StatBadge label="运行方式" value="纯浏览器" />
              <StatBadge label="书签引擎" value="Pyodide + pypdf" />
            </div>
          </div>

          <div className="grid gap-4 rounded-[1.5rem] border border-slate-900/10 bg-slate-950 p-5 text-slate-100">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-300">
                流程
              </p>
              <WandSparkles className="h-4 w-4 text-orange-300" />
            </div>
            <ol className="grid gap-3 text-sm text-slate-300">
              <FlowItem
                icon={<FileUp className="h-4 w-4" />}
                title="1. 上传 PDF"
                description="文件始终留在当前浏览器标签页。"
              />
              <FlowItem
                icon={<ImageDown className="h-4 w-4" />}
                title="2. 导出目录页"
                description="把指定页渲染并下载为 PNG 图片。"
              />
              <FlowItem
                icon={<FileJson2 className="h-4 w-4" />}
                title="3. 粘贴模型 JSON"
                description="Gemini、GPT、Qwen、Claude 或其他视觉模型都可以。"
              />
              <FlowItem
                icon={<FileOutput className="h-4 w-4" />}
                title="4. 下载带目录 PDF"
                description="书签写入在 Web Worker 里由 Pyodide 完成。"
              />
            </ol>
          </div>
        </header>

        <main className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_1.25fr]">
          <section className="grid gap-6">
            <Panel
              eyebrow="步骤 1"
              title="上传 PDF，并填写目录页范围"
              description="选择输入文件，并填写印刷版目录所在的页码范围。"
            >
              <div className="grid gap-4">
                <label className="group grid cursor-pointer gap-3 rounded-[1.5rem] border border-dashed border-slate-400/60 bg-slate-950/[0.03] p-5 transition hover:border-sky-500 hover:bg-sky-50">
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-900">
                    <FileUp className="h-4 w-4 text-sky-700" />
                    {pdfFile ? pdfFile.name : '选择 PDF'}
                  </span>
                  <span className="text-sm text-slate-600">
                    {pdfPageCount
                      ? `已检测到 ${pdfPageCount} 页。`
                      : '文件只会在浏览器里读取，不会上传到任何服务器。'}
                  </span>
                  <input
                    accept="application/pdf"
                    className="hidden"
                    onChange={handleFileChange}
                    type="file"
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    hint="例如 11"
                    label="目录起始页"
                    onChange={setRangeStart}
                    value={rangeStart}
                  />
                  <Field
                    hint="例如 14"
                    label="目录结束页"
                    onChange={setRangeEnd}
                    value={rangeEnd}
                  />
                </div>

                <div className="flex flex-wrap gap-3">
                  <ActionButton
                    busy={renderState.loading}
                    icon={<ImageDown className="h-4 w-4" />}
                    label="渲染目录页"
                    onClick={handleRenderTocPages}
                    tone="dark"
                  />
                  <ActionButton
                    disabled={renderedPages.length === 0}
                    icon={<ArrowDownToLine className="h-4 w-4" />}
                    label="下载 PNG 压缩包"
                    onClick={handleDownloadImages}
                    tone="light"
                  />
                </div>

                <StatusMessage loading={renderState.loading} message={renderState.message} />
              </div>
            </Panel>

            <Panel
              eyebrow="步骤 2"
              title="把目录页交给视觉模型"
              description="网站本身不绑定任何模型，你只要选择自己觉得最好用的视觉大模型即可。"
            >
              <div className="grid gap-4">
                <div className="flex flex-wrap gap-3">
                  <ActionButton
                    icon={<Copy className="h-4 w-4" />}
                    label="复制提取提示词"
                    onClick={handleCopyPrompt}
                    tone="light"
                  />
                  <a
                    className="inline-flex items-center gap-2 rounded-full border border-slate-900/10 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-900/20 hover:bg-slate-50"
                    href="https://aistudio.google.com"
                    rel="noreferrer"
                    target="_blank"
                  >
                    打开 Gemini（示例）
                  </a>
                </div>
                <pre className="max-h-72 overflow-auto rounded-[1.5rem] border border-slate-900/10 bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  {PROMPT_TEMPLATE}
                </pre>
              </div>
            </Panel>

            <Panel
              eyebrow="步骤 3"
              title="粘贴模型返回的 JSON"
              description="校验器会自动去掉 Markdown 代码围栏、标准化字段，并把不确定条目放到主目录之外。"
            >
              <div className="grid gap-4">
                <textarea
                  className="min-h-64 rounded-[1.5rem] border border-slate-900/10 bg-white px-4 py-4 font-mono text-sm leading-6 text-slate-900 shadow-inner outline-none ring-0 transition placeholder:text-slate-400 focus:border-sky-500"
                  onChange={(event) => setJsonInput(event.target.value)}
                  placeholder={`把 JSON 代码围栏粘贴到这里…\n\n{\n  "entries": [\n    { "order": 1, "level": 1, "title": "第1章 ...", "page_label": "1" }\n  ]\n}`}
                  spellCheck={false}
                  value={jsonInput}
                />
                <StatusMessage
                  accent={jsonState.ok ? 'success' : 'warning'}
                  message={jsonState.message}
                />
              </div>
            </Panel>

            <Panel
              eyebrow="步骤 4"
              title="给书内页和 PDF 页建立锚点"
              description="你只需要提供一组映射，程序会自动推算其余页码偏移。"
            >
              <div className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    hint="通常填 1"
                    label="书内页"
                    onChange={setAnchorBookPage}
                    value={anchorBookPage}
                  />
                  <Field
                    hint="例如 15"
                    label="实际 PDF 页"
                    onChange={setAnchorPdfPage}
                    value={anchorPdfPage}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <ActionButton
                    busy={buildState.loading}
                    disabled={!pdfBytes || resolvedEntries.length === 0}
                    icon={<FileCog className="h-4 w-4" />}
                    label="生成带书签 PDF"
                    onClick={handleGeneratePdf}
                    tone="accent"
                  />
                  {outputFile ? (
                    <a
                      className="inline-flex items-center gap-2 rounded-full border border-slate-900/10 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-900/20 hover:bg-slate-50"
                      download={outputFile.fileName}
                      href={outputFile.objectUrl}
                    >
                      <ArrowDownToLine className="h-4 w-4" />
                      下载结果 PDF
                    </a>
                  ) : null}
                </div>
                <StatusMessage loading={buildState.loading} message={buildState.message} />
                <p className="text-sm text-slate-500">
                  第一次运行会下载 Pyodide 并在 Worker 里安装 pypdf，所以会比第二次稍慢。
                </p>
              </div>
            </Panel>
          </section>

          <section className="grid gap-6">
            <Panel
              eyebrow="预览"
              title="目录页图片"
              description="这里展示的是可以直接交给视觉模型的目录页图片。"
            >
              {renderedPages.length === 0 ? (
                <EmptyState
                  title="还没有渲染目录页"
                  description="先渲染一个页范围，这里才会显示导出的 PNG 预览。"
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {renderedPages.map((page) => (
                    <figure
                      className="overflow-hidden rounded-[1.5rem] border border-slate-900/10 bg-white shadow-[0_18px_38px_rgba(15,23,42,0.06)]"
                      key={page.pdfPageNumber}
                    >
                      <div className="flex items-center justify-between border-b border-slate-900/10 px-4 py-3 text-sm font-medium text-slate-700">
                        <span>PDF 第 {page.pdfPageNumber} 页</span>
                        <span className="rounded-full bg-slate-950 px-2 py-1 text-xs text-white">
                          图片 {page.tocImageIndex}
                        </span>
                      </div>
                      <img
                        alt={`目录页 ${page.pdfPageNumber}`}
                        className="w-full bg-slate-100 object-contain"
                        height={page.height}
                        src={page.objectUrl}
                        width={page.width}
                      />
                    </figure>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              eyebrow="结构"
              title="校验后的目录树预览"
              description="这里展示的是标准化后的目录结构以及对应的 PDF 页码。"
            >
              {!tocStats ? (
                <EmptyState
                  title="还没有解析 JSON"
                  description="把模型输出粘贴进来后，这里会显示目录树和映射结果。"
                />
              ) : (
                <div className="grid gap-5">
                  <div className="flex flex-wrap gap-3">
                    <StatBadge label="目录项" value={String(tocStats.entryCount)} />
                    <StatBadge label="已解析" value={String(resolvedEntries.length)} />
                    <StatBadge
                      label="不确定"
                      value={String(tocStats.uncertainCount)}
                    />
                  </div>
                  <div className="grid gap-3 rounded-[1.5rem] border border-slate-900/10 bg-white/90 p-4">
                    {resolvedEntries.slice(0, 80).map((entry) => (
                      <div
                        className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-900/5 bg-slate-950/[0.02] px-4 py-3"
                        key={`${entry.order}-${entry.title}`}
                        style={{ marginLeft: `${(entry.level - 1) * 12}px` }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900">{entry.title}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                            层级 {entry.level} · 书内页 {entry.pageLabel}
                          </p>
                        </div>
                        <div className="shrink-0 rounded-full bg-slate-950 px-3 py-1 text-xs font-medium text-white">
                          PDF {entry.resolvedPdfPage}
                        </div>
                      </div>
                    ))}
                    {resolvedEntries.length > 80 ? (
                      <p className="text-sm text-slate-500">
                        这里只展示前 80 条，实际生成的 PDF 仍会包含全部已解析目录。
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </Panel>
          </section>
        </main>
      </div>
    </div>
  )

  function resetRenderedPages() {
    setRenderedPages((current) => {
      for (const page of current) {
        URL.revokeObjectURL(page.objectUrl)
      }
      return []
    })
  }

  function resetOutputFile() {
    setOutputFile((current) => {
      if (current) {
        URL.revokeObjectURL(current.objectUrl)
      }
      return null
    })
  }
}

function getWorker(reference: MutableRefObject<Worker | null>) {
  if (reference.current) {
    return reference.current
  }

  const worker = new Worker(new URL('./workers/bookmark.worker.ts', import.meta.url), {
    type: 'module',
  })
  reference.current = worker
  return worker
}

async function runBookmarkWorker(
  worker: Worker,
  request: BookmarkWorkerRequest,
  onProgress: (message: string) => void,
): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const handleMessage = (event: MessageEvent<BookmarkWorkerResponse>) => {
      const payload = event.data
      if (payload.type === 'progress') {
        onProgress(payload.message)
        return
      }

      if (payload.type === 'success') {
        cleanup()
        resolve(payload.pdfBytes)
        return
      }

      if (payload.type === 'error') {
        cleanup()
        reject(new Error(payload.message))
      }
    }

    const cleanup = () => {
      worker.removeEventListener('message', handleMessage)
    }

    worker.addEventListener('message', handleMessage)
    worker.postMessage(request, [request.pdfBytes])
  })
}

function buildOutputName(name: string) {
  const stem = name.replace(/\.pdf$/i, '')
  return `${stem}.已加书签.pdf`
}

function triggerDownload(objectUrl: string, fileName: string) {
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
}

function Panel(props: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[1.75rem] border border-slate-900/10 bg-white/82 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6">
      <div className="mb-5 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
          {props.eyebrow}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
          {props.title}
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">{props.description}</p>
      </div>
      {props.children}
    </section>
  )
}

function Field(props: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-800">{props.label}</span>
      <input
        className="rounded-2xl border border-slate-900/10 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500"
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.hint}
        type="text"
        value={props.value}
      />
    </label>
  )
}

function ActionButton(props: {
  label: string
  icon: ReactNode
  onClick: () => void
  tone: 'dark' | 'light' | 'accent'
  disabled?: boolean
  busy?: boolean
}) {
  const base =
    'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50'
  const toneClass =
    props.tone === 'dark'
      ? 'bg-slate-950 text-white hover:bg-slate-800'
      : props.tone === 'accent'
        ? 'bg-orange-500 text-white hover:bg-orange-400'
        : 'border border-slate-900/10 bg-white text-slate-900 hover:border-slate-900/20 hover:bg-slate-50'

  return (
    <button
      className={`${base} ${toneClass}`}
      disabled={props.disabled || props.busy}
      onClick={props.onClick}
      type="button"
    >
      {props.busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : props.icon}
      {props.label}
    </button>
  )
}

function StatusMessage(props: {
  message: string
  loading?: boolean
  accent?: 'default' | 'success' | 'warning'
}) {
  const accentClass =
    props.accent === 'success'
      ? 'border-emerald-500/30 bg-emerald-50 text-emerald-900'
      : props.accent === 'warning'
        ? 'border-amber-500/30 bg-amber-50 text-amber-950'
        : 'border-slate-900/10 bg-slate-950/[0.04] text-slate-700'

  return (
    <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${accentClass}`}>
      {props.loading ? (
        <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <p className="leading-6">{props.message}</p>
    </div>
  )
}

function EmptyState(props: { title: string; description: string }) {
  return (
    <div className="grid min-h-52 place-items-center rounded-[1.5rem] border border-dashed border-slate-900/10 bg-slate-950/[0.02] p-8 text-center">
      <div className="max-w-sm space-y-2">
        <p className="text-lg font-medium text-slate-900">{props.title}</p>
        <p className="text-sm leading-6 text-slate-600">{props.description}</p>
      </div>
    </div>
  )
}

function FlowItem(props: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3">
      <span className="mt-0.5 text-sky-300">{props.icon}</span>
      <div className="space-y-1">
        <p className="font-medium text-white">{props.title}</p>
        <p className="text-slate-400">{props.description}</p>
      </div>
    </li>
  )
}

function StatBadge(props: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-slate-900/10 bg-white px-3 py-2 text-sm">
      <span className="font-semibold text-slate-900">{props.label}</span>
      <span className="mx-2 text-slate-400">/</span>
      <span className="text-slate-600">{props.value}</span>
    </div>
  )
}

export default App
