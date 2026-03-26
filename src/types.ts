export type TocEntry = {
  order: number
  tocImageIndex?: number
  level: number
  title: string
  pageLabel: string
  uncertain: boolean
}

export type TocUncertainEntry = {
  tocImageIndex?: number
  rawText: string
  reason?: string
}

export type ParsedTocPayload = {
  entries: TocEntry[]
  uncertainEntries: TocUncertainEntry[]
}

export type ResolvedTocEntry = TocEntry & {
  bookPageNumber: number
  resolvedPdfPage: number
}

export type RenderedPage = {
  tocImageIndex: number
  pdfPageNumber: number
  blob: Blob
  objectUrl: string
  width: number
  height: number
}

export type BookmarkWorkerRequest = {
  type: 'build'
  pdfBytes: ArrayBuffer
  entries: ResolvedTocEntry[]
}

export type BookmarkWorkerResponse =
  | { type: 'progress'; message: string }
  | { type: 'success'; pdfBytes: ArrayBuffer }
  | { type: 'error'; message: string }
