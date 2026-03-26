import type { RenderedPage } from '../types'

let runtimePromise:
  | Promise<{
      getDocument: typeof import('pdfjs-dist').getDocument
    }>
  | null = null

async function loadPdfRuntime() {
  if (runtimePromise) {
    return runtimePromise
  }

  runtimePromise = (async () => {
    const pdfjs = await import('pdfjs-dist')
    const pdfWorkerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    return {
      getDocument: pdfjs.getDocument,
    }
  })()

  return runtimePromise
}

export async function readPdfPageCount(pdfBytes: ArrayBuffer) {
  const { getDocument } = await loadPdfRuntime()
  const loadingTask = getDocument({ data: new Uint8Array(pdfBytes.slice(0)) })
  const pdfDocument = await loadingTask.promise
  const count = pdfDocument.numPages
  pdfDocument.cleanup()
  return count
}

export async function renderPdfPages(
  pdfBytes: ArrayBuffer,
  startPage: number,
  endPage: number,
): Promise<RenderedPage[]> {
  const { getDocument } = await loadPdfRuntime()
  const loadingTask = getDocument({ data: new Uint8Array(pdfBytes.slice(0)) })
  const pdfDocument = await loadingTask.promise
  const pages: RenderedPage[] = []

  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = window.document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('当前浏览器不支持 Canvas 渲染。')
    }

    canvas.width = viewport.width
    canvas.height = viewport.height

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise

    const blob = await canvasToBlob(canvas)
    pages.push({
      tocImageIndex: pageNumber - startPage + 1,
      pdfPageNumber: pageNumber,
      blob,
      objectUrl: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
    })

    page.cleanup()
    canvas.width = 0
    canvas.height = 0
  }

  pdfDocument.cleanup()
  return pages
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas 无法转换为 PNG 图片。'))
        return
      }
      resolve(blob)
    }, 'image/png')
  })
}
