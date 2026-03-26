import { z } from 'zod'

import type { ParsedTocPayload, ResolvedTocEntry, TocEntry } from '../types'

const tocEntrySchema = z.object({
  order: z.number().int().positive(),
  toc_image_index: z.number().int().positive().optional(),
  level: z.number().int().positive(),
  title: z.string().trim().min(1),
  page_label: z.union([z.string(), z.number()]).transform((value) => String(value).trim()),
  uncertain: z.boolean().optional().default(false),
})

const uncertainEntrySchema = z.object({
  toc_image_index: z.number().int().positive().optional(),
  raw_text: z.string().trim().min(1),
  reason: z.string().trim().optional(),
})

const tocPayloadSchema = z.object({
  entries: z.array(tocEntrySchema),
  uncertain_entries: z.array(uncertainEntrySchema).optional().default([]),
})

export function parseTocPayload(source: string): ParsedTocPayload {
  const stripped = stripJsonFence(source)
  const raw = JSON.parse(stripped)
  const parsed = tocPayloadSchema.parse(raw)

  const entries = parsed.entries
    .map<TocEntry>((entry) => ({
      order: entry.order,
      tocImageIndex: entry.toc_image_index,
      level: entry.level,
      title: normalizeTitle(entry.title),
      pageLabel: entry.page_label,
      uncertain: entry.uncertain,
    }))
    .sort((left, right) => left.order - right.order)

  return {
    entries,
    uncertainEntries: parsed.uncertain_entries.map((entry) => ({
      tocImageIndex: entry.toc_image_index,
      rawText: entry.raw_text,
      reason: entry.reason,
    })),
  }
}

export function resolveTocEntries(
  payload: ParsedTocPayload,
  anchorBookPageText: string,
  anchorPdfPageText: string,
  pdfPageCount?: number,
) {
  const errors: string[] = []
  const anchorBookPage = Number(anchorBookPageText)
  const anchorPdfPage = Number(anchorPdfPageText)

  if (!Number.isInteger(anchorBookPage) || anchorBookPage <= 0) {
    errors.push('请填写有效的书内页锚点，必须是大于 0 的整数。')
  }

  if (!Number.isInteger(anchorPdfPage) || anchorPdfPage <= 0) {
    errors.push('请填写有效的 PDF 页锚点，必须是大于 0 的整数。')
  }

  if (errors.length > 0) {
    return {
      entries: [] as ResolvedTocEntry[],
      errors,
    }
  }

  const offset = anchorPdfPage - anchorBookPage
  const entries = payload.entries.flatMap<ResolvedTocEntry>((entry) => {
    if (!/^\d+$/.test(entry.pageLabel)) {
      return []
    }

    const bookPageNumber = Number(entry.pageLabel)
    const resolvedPdfPage = bookPageNumber + offset
    if (resolvedPdfPage <= 0) {
      return []
    }
    if (pdfPageCount && resolvedPdfPage > pdfPageCount) {
      return []
    }

    return [
      {
        ...entry,
        bookPageNumber,
        resolvedPdfPage,
      },
    ]
  })

  return {
    entries,
    errors,
  }
}

function stripJsonFence(source: string) {
  const trimmed = source.trim()
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenceMatch ? fenceMatch[1] : trimmed
}

function normalizeTitle(title: string) {
  return title.replace(/\s+/g, ' ').trim()
}
