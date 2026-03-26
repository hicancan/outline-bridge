/// <reference lib="webworker" />

import type { BookmarkWorkerRequest, BookmarkWorkerResponse } from '../types'

const workerScope = self as DedicatedWorkerGlobalScope

const PYODIDE_VERSION = '0.29.3'
const PYPDF_VERSION = '6.9.2'
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

type PyodideRuntime = {
  globals: {
    set: (name: string, value: unknown) => void
    delete?: (name: string) => void
  }
  loadPackage: (name: string) => Promise<void>
  pyimport: (name: string) => { install: (specifier: string) => Promise<void>; destroy?: () => void }
  runPythonAsync: (script: string) => Promise<string>
}

let pyodideReadyPromise: Promise<PyodideRuntime> | null = null

workerScope.addEventListener('message', async (event: MessageEvent<BookmarkWorkerRequest>) => {
  if (event.data.type !== 'build') {
    return
  }

  let pyodide: PyodideRuntime | null = null

  try {
    postProgress('正在 Worker 中加载 Pyodide…')
    pyodide = await ensurePyodide()

    postProgress('正在准备书签数据…')
    pyodide.globals.set('source_pdf_bytes', new Uint8Array(event.data.pdfBytes))
    pyodide.globals.set('outline_entries', event.data.entries)

    postProgress('正在用 pypdf 写入书签…')
    const base64Result = await pyodide.runPythonAsync(PYTHON_BUILD_SCRIPT)
    const pdfBytes = base64ToArrayBuffer(base64Result)

    const response: BookmarkWorkerResponse = {
      type: 'success',
      pdfBytes,
    }
    workerScope.postMessage(response, [pdfBytes])
  } catch (error) {
    const response: BookmarkWorkerResponse = {
      type: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Worker 内的 PDF 书签生成失败。',
    }
    workerScope.postMessage(response)
  } finally {
    pyodide?.globals.delete?.('source_pdf_bytes')
    pyodide?.globals.delete?.('outline_entries')
  }
})

async function ensurePyodide() {
  if (pyodideReadyPromise) {
    return pyodideReadyPromise
  }

  pyodideReadyPromise = (async () => {
    const { loadPyodide } = await import(
      /* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`
    )
    const pyodide = await loadPyodide({
      indexURL: PYODIDE_INDEX_URL,
    })

    await pyodide.loadPackage('micropip')
    const micropip = pyodide.pyimport('micropip')
    await micropip.install(`pypdf==${PYPDF_VERSION}`)
    micropip.destroy?.()
    return pyodide
  })()

  return pyodideReadyPromise
}

function postProgress(message: string) {
  const response: BookmarkWorkerResponse = {
    type: 'progress',
    message,
  }
  workerScope.postMessage(response)
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

const PYTHON_BUILD_SCRIPT = `
import base64
import io
from pypdf import PdfReader, PdfWriter

source_pdf = bytes(source_pdf_bytes.to_py())
entries = outline_entries.to_py()

reader = PdfReader(io.BytesIO(source_pdf))
writer = PdfWriter()
writer.clone_document_from_reader(reader)

parents = {}
for item in entries:
    level = int(item["level"])
    pdf_page = int(item["resolvedPdfPage"]) - 1
    parent = parents.get(level - 1)
    node = writer.add_outline_item(
        title=item["title"],
        page_number=pdf_page,
        parent=parent,
    )
    parents[level] = node
    parents = {k: v for k, v in parents.items() if k <= level}

buffer = io.BytesIO()
writer.write(buffer)
base64.b64encode(buffer.getvalue()).decode("ascii")
`

export {}
