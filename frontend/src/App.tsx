import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'

const PAGE_SIZE = 20
const SUGGEST_LIMIT = 8
const MAX_WORD_LEN = 200
const MAX_MEANING_LEN = 500
const MAX_MEMO_LEN = 1000
const MAX_TAG_LEN = 100
const MAX_EXAMPLE_LEN = 1000
const MAX_RECENT_TAGS = 20
const MEANING_CHIP_MAX_LEN = 22
const COLLAPSED_MEANING_LINE_LIMIT = 3
const RECENT_TAGS_STORAGE_KEY = 'voca-note:recent-tags:v2'
const PRONUNCIATION_TAG = '발음'

type ToastType = 'success' | 'error'

interface ToastState {
  type: ToastType
  message: string
}

interface VocaResponse {
  id: number
  word: string
  ipa: string | null
  audioUrl: string | null
  meaningKo: string | null
  memo: string | null
  tags: string[] | null
  examples: string[] | null
  createdAt: string
  updatedAt: string
}

interface PageResponse<T> {
  items: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

interface SuggestItem {
  word: string
  score: number | null
}

interface SuggestResponse {
  query: string
  items: SuggestItem[]
}

interface EntryResponse {
  word: string
  phonetics: {
    ipa: string | null
    audioUrl: string | null
  } | null
  pos: string[]
  definitionsEn: string[]
  examples: string[]
  meaningKo: string | null
  source: {
    dictionary: string | null
    translation: string | null
  } | null
}

interface TagTreeNode {
  path: string
  name: string
  depth: number
  children: TagTreeNode[]
}

interface TagPickerModalProps {
  open: boolean
  title: string
  nodes: TagTreeNode[]
  selectedTags: string[]
  loading: boolean
  anchorEl: HTMLElement | null
  onClose: () => void
  onApply: (tags: string[]) => void
}

interface FormState {
  word: string
  meaningKo: string
  memo: string
  tagsText: string
  examplesText: string
}

interface BulkParsedEntry {
  key: string
  lineNo: number
  rawLine: string
  word: string
  meaningOverride: string | null
}

interface BulkParseIssue {
  lineNo: number
  value: string
  message: string
}

interface BulkParseResult {
  entries: BulkParsedEntry[]
  issues: BulkParseIssue[]
  duplicateRemoved: number
}

interface BulkSaveFailure {
  key: string
  lineNo: number
  word: string
  message: string
}

interface BulkSaveReport {
  total: number
  successCount: number
  failedCount: number
  failures: BulkSaveFailure[]
}

interface BulkCaretContext {
  lineNo: number
  lineStart: number
  lineEnd: number
  tokenStart: number
  tokenEnd: number
  tokenValue: string
  lineValue: string
}

interface TextareaCaretClientPosition {
  top: number
  left: number
  lineHeight: number
}

interface ErrorBody {
  message?: string
  fieldErrors?: Record<string, string>
}

class ApiError extends Error {
  status: number
  fieldErrors: Record<string, string>

  constructor(status: number, message: string, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

const EMPTY_FORM: FormState = {
  word: '',
  meaningKo: '',
  memo: '',
  tagsText: '',
  examplesText: '',
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')

  let payload: unknown = null
  if (response.status !== 204) {
    if (isJson) {
      payload = await response.json().catch(() => null)
    } else {
      payload = await response.text().catch(() => null)
    }
  }

  if (!response.ok) {
    let message = `요청에 실패했습니다. (${response.status})`
    let fieldErrors: Record<string, string> = {}

    if (payload && typeof payload === 'object') {
      const body = payload as ErrorBody
      if (typeof body.message === 'string' && body.message.trim().length > 0) {
        message = body.message
      }
      if (body.fieldErrors && typeof body.fieldErrors === 'object') {
        fieldErrors = Object.entries(body.fieldErrors).reduce<Record<string, string>>((acc, [key, value]) => {
          if (typeof value === 'string') {
            acc[key] = value
          }
          return acc
        }, {})
      }
    }

    if (typeof payload === 'string' && payload.trim().length > 0) {
      message = payload
    }

    throw new ApiError(response.status, message, fieldErrors)
  }

  return payload as T
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return debounced
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function lookupEntryWithRetry(targetWord: string, maxAttempts = 3): Promise<EntryResponse | null> {
  const normalized = targetWord.trim()
  if (normalized.length === 0) {
    return null
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await apiRequest<EntryResponse>(`/api/entry?word=${encodeURIComponent(normalized)}`)
    } catch (error) {
      const isRateLimited = error instanceof ApiError && error.status === 429
      if (isRateLimited && attempt < maxAttempts) {
        await sleep(250 * attempt)
        continue
      }
      return null
    }
  }

  return null
}

function toNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseTags(value: string): string[] {
  const unique = new Set<string>()
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .forEach((item) => unique.add(item))

  return [...unique]
}

function normalizeTagPath(path: string): string | null {
  const normalized = path
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('/')

  return normalized.length > 0 ? normalized : null
}

function normalizeTagList(tags: string[]): string[] {
  const unique = new Set<string>()
  tags
    .map((tag) => normalizeTagPath(tag))
    .filter((tag): tag is string => Boolean(tag))
    .forEach((tag) => unique.add(tag))
  return [...unique]
}

function loadRecentTags(): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(RECENT_TAGS_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    const normalized = normalizeTagList(parsed.filter((item): item is string => typeof item === 'string'))
    return normalized.slice(0, MAX_RECENT_TAGS)
  } catch {
    return []
  }
}

function saveRecentTags(tags: string[]): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const normalized = normalizeTagList(tags).slice(0, MAX_RECENT_TAGS)
    window.localStorage.setItem(RECENT_TAGS_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // localStorage 접근 실패시 최근 태그 저장을 생략한다.
  }
}

function normalizeRecentTags(tags: string[]): string[] {
  return collapseHierarchicalTags(tags).slice(0, MAX_RECENT_TAGS)
}

function addTagPath(tags: string[], tagPath: string): string[] {
  const normalized = normalizeTagPath(tagPath)
  if (!normalized) {
    return collapseHierarchicalTags(tags)
  }
  return collapseHierarchicalTags([...tags, normalized])
}

function toggleTagPath(tags: string[], tagPath: string): string[] {
  const normalized = normalizeTagPath(tagPath)
  if (!normalized) {
    return collapseHierarchicalTags(tags)
  }

  const collapsed = collapseHierarchicalTags(tags)
  if (collapsed.includes(normalized)) {
    return collapsed.filter((tag) => tag !== normalized)
  }
  return addTagPath(collapsed, normalized)
}

function isSameTagBranch(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

function collapseHierarchicalTags(tags: string[]): string[] {
  const normalized = normalizeTagList(tags)
  const bySpecificityDesc = [...normalized].sort((a, b) => {
    const depthGap = b.split('/').length - a.split('/').length
    if (depthGap !== 0) {
      return depthGap
    }
    return b.length - a.length
  })

  const kept: string[] = []
  bySpecificityDesc.forEach((tag) => {
    const hasDescendantAlready = kept.some((existing) => existing.startsWith(`${tag}/`))
    if (!hasDescendantAlready) {
      kept.push(tag)
    }
  })

  return kept.sort((a, b) => a.localeCompare(b, 'ko-KR'))
}

function parseExamples(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeExamplesForSave(examples: string[]): string[] {
  const unique = new Set<string>()
  examples
    .map((example) => clampText(example.trim(), MAX_EXAMPLE_LEN))
    .filter((example) => example.length > 0)
    .forEach((example) => unique.add(example))
  return [...unique]
}

function clampText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function toNumberedLines(value: string): string {
  return value
    .replace(/\s+(?=\d+\.\s)/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function normalizeMeaningForSave(value: string | null): string | null {
  if (!value) {
    return null
  }

  const normalizedText = toNumberedLines(value)
  if (normalizedText.length === 0) {
    return null
  }

  const items = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^(?:\d+\s*[.)]\s*|[-*•]\s*)/, '').trim())
    .filter((line) => line.length > 0)

  if (items.length === 0) {
    return null
  }
  if (items.length === 1) {
    return items[0]
  }

  return items.map((line, index) => `${index + 1}. ${line}`).join('\n')
}

function parseBulkMeaningOverride(value: string): string | null {
  const normalizedInput = value
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join('\n')

  if (normalizedInput.length === 0) {
    return null
  }

  return normalizeMeaningForSave(normalizedInput)
}

function findBulkDelimiterIndex(value: string): number {
  const tabIndex = value.indexOf('\t')
  const pipeIndex = value.indexOf('|')
  if (tabIndex >= 0 && pipeIndex >= 0) {
    return Math.min(tabIndex, pipeIndex)
  }
  return Math.max(tabIndex, pipeIndex)
}

function parseBulkInput(value: string): BulkParseResult {
  const issues: BulkParseIssue[] = []
  const parsedEntries: BulkParsedEntry[] = []

  value.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const lineNo = lineIndex + 1
    const trimmedLine = rawLine.trim()
    if (trimmedLine.length === 0) {
      return
    }

    const delimiterIndex = findBulkDelimiterIndex(rawLine)
    if (delimiterIndex >= 0) {
      const rawWord = rawLine.slice(0, delimiterIndex).trim()
      const rawMeaning = rawLine.slice(delimiterIndex + 1).trim()
      const word = normalizeWordInput(rawWord).trim()
      if (word.length === 0) {
        issues.push({
          lineNo,
          value: rawLine,
          message: '단어가 비어 있습니다. "단어<TAB>뜻" 또는 "단어|뜻" 형식을 확인해 주세요.',
        })
        return
      }

      parsedEntries.push({
        key: `line-${lineNo}-0`,
        lineNo,
        rawLine,
        word,
        meaningOverride: parseBulkMeaningOverride(rawMeaning),
      })
      return
    }

    const words = rawLine
      .split(',')
      .map((part) => normalizeWordInput(part.trim()).trim())
      .filter((part) => part.length > 0)

    if (words.length === 0) {
      return
    }

    words.forEach((word, index) => {
      parsedEntries.push({
        key: `line-${lineNo}-${index}`,
        lineNo,
        rawLine,
        word,
        meaningOverride: null,
      })
    })
  })

  const dedupedEntries = new Map<string, BulkParsedEntry>()
  let duplicateRemoved = 0

  parsedEntries.forEach((entry) => {
    const duplicateKey = entry.word.toLowerCase()
    if (dedupedEntries.has(duplicateKey)) {
      dedupedEntries.delete(duplicateKey)
      duplicateRemoved += 1
    }
    dedupedEntries.set(duplicateKey, entry)
  })

  const entries = [...dedupedEntries.values()].sort((left, right) => {
    if (left.lineNo !== right.lineNo) {
      return left.lineNo - right.lineNo
    }
    return left.key.localeCompare(right.key)
  })

  return { entries, issues, duplicateRemoved }
}

function stripMeaningNumberPrefix(value: string): string {
  return value.replace(/^\d+\.\s*/, '').trim()
}

function formatMeaningForBulkLine(value: string | null): string {
  if (!value) {
    return ''
  }
  const parts = parseMeaningLines(value).map(stripMeaningNumberPrefix).filter((part) => part.length > 0)
  return parts.join('; ')
}

function findLineRangeAtPosition(value: string, position: number): { lineStart: number; lineEnd: number; lineNo: number; lineValue: string } {
  const clamped = Math.max(0, Math.min(position, value.length))
  const lineStart = value.lastIndexOf('\n', clamped - 1) + 1
  const nextLineBreak = value.indexOf('\n', clamped)
  const lineEnd = nextLineBreak >= 0 ? nextLineBreak : value.length
  const lineValue = value.slice(lineStart, lineEnd)
  const lineNo = value.slice(0, lineStart).split('\n').length
  return { lineStart, lineEnd, lineNo, lineValue }
}

function getBulkCaretContext(value: string, position: number): BulkCaretContext | null {
  const { lineStart, lineEnd, lineNo, lineValue } = findLineRangeAtPosition(value, position)
  const relativeCaret = Math.max(0, Math.min(position - lineStart, lineValue.length))
  const delimiterIndex = findBulkDelimiterIndex(lineValue)
  const wordAreaEnd = delimiterIndex >= 0 ? delimiterIndex : lineValue.length

  if (relativeCaret > wordAreaEnd) {
    return null
  }

  const wordArea = lineValue.slice(0, wordAreaEnd)
  const leftCommaIndex = wordArea.lastIndexOf(',', Math.max(0, relativeCaret - 1))
  const tokenStartInLine = leftCommaIndex >= 0 ? leftCommaIndex + 1 : 0
  const rightCommaIndex = wordArea.indexOf(',', relativeCaret)
  const tokenEndInLine = rightCommaIndex >= 0 ? rightCommaIndex : wordArea.length

  const tokenRaw = wordArea.slice(tokenStartInLine, tokenEndInLine)
  const tokenValue = normalizeWordInput(tokenRaw.trim())
  if (tokenValue.length === 0) {
    return null
  }

  return {
    lineNo,
    lineStart,
    lineEnd,
    tokenStart: lineStart + tokenStartInLine,
    tokenEnd: lineStart + tokenEndInLine,
    tokenValue,
    lineValue,
  }
}

function getTextareaCaretClientPosition(textarea: HTMLTextAreaElement, position: number): TextareaCaretClientPosition | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null
  }

  const computed = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const styleToCopy = [
    'boxSizing',
    'width',
    'overflowX',
    'overflowY',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'fontStretch',
    'fontSize',
    'lineHeight',
    'fontFamily',
    'textAlign',
    'textTransform',
    'textIndent',
    'textDecoration',
    'letterSpacing',
    'wordSpacing',
    'tabSize',
  ]

  styleToCopy.forEach((property) => {
    const value = computed.getPropertyValue(property)
    if (value) {
      mirror.style.setProperty(property, value)
    }
  })

  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  mirror.style.overflow = 'visible'
  mirror.style.left = '-9999px'
  mirror.style.top = '0'
  mirror.style.width = `${textarea.clientWidth}px`
  mirror.style.height = 'auto'

  const clamped = Math.max(0, Math.min(position, textarea.value.length))
  mirror.textContent = textarea.value.slice(0, clamped)

  const marker = document.createElement('span')
  marker.textContent = textarea.value.slice(clamped) || '.'
  mirror.appendChild(marker)

  document.body.appendChild(mirror)

  const markerRect = marker.getBoundingClientRect()
  const mirrorRect = mirror.getBoundingClientRect()
  const textareaRect = textarea.getBoundingClientRect()
  const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.2 || 18

  document.body.removeChild(mirror)

  const top = textareaRect.top + (markerRect.top - mirrorRect.top) - textarea.scrollTop
  const left = textareaRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft

  return { top, left, lineHeight }
}

function parseMeaningLines(value: string | null): string[] {
  if (!value) {
    return []
  }
  return toNumberedLines(value)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function isMeaningChipLine(value: string): boolean {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length === 0) {
    return false
  }
  const plain = compact.replace(/^\d+\.\s*/, '')
  return plain.length <= MEANING_CHIP_MAX_LEN
}

function isLongText(value: string, maxChars: number, maxLines: number): boolean {
  const lines = value.split('\n').length
  return value.length > maxChars || lines > maxLines
}

function joinTags(tags: string[] | null): string {
  if (!tags || tags.length === 0) {
    return ''
  }
  return tags.join(', ')
}

function joinExamples(examples: string[] | null): string {
  if (!examples || examples.length === 0) {
    return ''
  }
  return examples.join('\n')
}

function getFieldError(fieldErrors: Record<string, string>, field: string): string | undefined {
  if (fieldErrors[field]) {
    return fieldErrors[field]
  }

  const nestedKey = Object.keys(fieldErrors).find((key) => key.startsWith(`${field}[`))
  if (!nestedKey) {
    return undefined
  }
  return fieldErrors[nestedKey]
}

function buildPageNumbers(page: number, totalPages: number): number[] {
  if (totalPages <= 0) {
    return []
  }

  let start = Math.max(0, page - 2)
  const end = Math.min(totalPages - 1, start + 4)

  start = Math.max(0, end - 4)

  const pages: number[] = []
  for (let idx = start; idx <= end; idx += 1) {
    pages.push(idx)
  }
  return pages
}

function flattenTagTree(nodes: TagTreeNode[]): TagTreeNode[] {
  const flattened: TagTreeNode[] = []

  const visit = (target: TagTreeNode) => {
    flattened.push(target)
    target.children.forEach(visit)
  }

  nodes.forEach(visit)
  return flattened
}

const DATE_GROUP_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
})

function getLocalDateKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateGroupLabel(dateKey: string): string {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return dateKey
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) {
    return dateKey
  }

  return DATE_GROUP_FORMATTER.format(date)
}

function getSuggestionShortcutIndex(key: string): number | null {
  if (!/^[1-9]$/.test(key)) {
    return null
  }
  return Number(key) - 1
}

function getTopTabCompletion(input: string, suggestions: SuggestItem[]): SuggestItem | null {
  const typed = input.trim().toLowerCase()
  if (typed.length === 0 || suggestions.length === 0) {
    return null
  }

  const topSuggestion = suggestions[0]
  const candidate = topSuggestion.word.trim().toLowerCase()
  if (candidate.length < typed.length) {
    return null
  }
  if (candidate !== typed && !candidate.startsWith(typed)) {
    return null
  }

  return topSuggestion
}

const CHOSEONG_TO_QWERTY = ['r', 'R', 's', 'e', 'E', 'f', 'a', 'q', 'Q', 't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g']
const JUNGSEONG_TO_QWERTY = [
  'k',
  'o',
  'i',
  'O',
  'j',
  'p',
  'u',
  'P',
  'h',
  'hk',
  'ho',
  'hl',
  'y',
  'n',
  'nj',
  'np',
  'nl',
  'b',
  'm',
  'ml',
  'l',
]
const JONGSEONG_TO_QWERTY = [
  '',
  'r',
  'R',
  'rt',
  's',
  'sw',
  'sg',
  'e',
  'f',
  'fr',
  'fa',
  'fq',
  'ft',
  'fx',
  'fv',
  'fg',
  'a',
  'q',
  'qt',
  't',
  'T',
  'd',
  'w',
  'c',
  'z',
  'x',
  'v',
  'g',
]

const HANGUL_COMPAT_TO_QWERTY: Record<string, string> = {
  ㄱ: 'r',
  ㄲ: 'R',
  ㄳ: 'rt',
  ㄴ: 's',
  ㄵ: 'sw',
  ㄶ: 'sg',
  ㄷ: 'e',
  ㄸ: 'E',
  ㄹ: 'f',
  ㄺ: 'fr',
  ㄻ: 'fa',
  ㄼ: 'fq',
  ㄽ: 'ft',
  ㄾ: 'fx',
  ㄿ: 'fv',
  ㅀ: 'fg',
  ㅁ: 'a',
  ㅂ: 'q',
  ㅃ: 'Q',
  ㅄ: 'qt',
  ㅅ: 't',
  ㅆ: 'T',
  ㅇ: 'd',
  ㅈ: 'w',
  ㅉ: 'W',
  ㅊ: 'c',
  ㅋ: 'z',
  ㅌ: 'x',
  ㅍ: 'v',
  ㅎ: 'g',
  ㅏ: 'k',
  ㅐ: 'o',
  ㅑ: 'i',
  ㅒ: 'O',
  ㅓ: 'j',
  ㅔ: 'p',
  ㅕ: 'u',
  ㅖ: 'P',
  ㅗ: 'h',
  ㅘ: 'hk',
  ㅙ: 'ho',
  ㅚ: 'hl',
  ㅛ: 'y',
  ㅜ: 'n',
  ㅝ: 'nj',
  ㅞ: 'np',
  ㅟ: 'nl',
  ㅠ: 'b',
  ㅡ: 'm',
  ㅢ: 'ml',
  ㅣ: 'l',
}

function convertHangulCharToQwerty(char: string): string | null {
  const direct = HANGUL_COMPAT_TO_QWERTY[char]
  if (direct) {
    return direct
  }

  const code = char.codePointAt(0)
  if (code === undefined) {
    return null
  }

  // Hangul syllables (가-힣)
  if (code >= 0xac00 && code <= 0xd7a3) {
    const syllableIndex = code - 0xac00
    const choseongIndex = Math.floor(syllableIndex / 588)
    const jungseongIndex = Math.floor((syllableIndex % 588) / 28)
    const jongseongIndex = syllableIndex % 28
    return `${CHOSEONG_TO_QWERTY[choseongIndex]}${JUNGSEONG_TO_QWERTY[jungseongIndex]}${JONGSEONG_TO_QWERTY[jongseongIndex]}`
  }

  // Hangul Jamo (ᄀ-ᇂ)
  if (code >= 0x1100 && code <= 0x1112) {
    return CHOSEONG_TO_QWERTY[code - 0x1100]
  }
  if (code >= 0x1161 && code <= 0x1175) {
    return JUNGSEONG_TO_QWERTY[code - 0x1161]
  }
  if (code >= 0x11a8 && code <= 0x11c2) {
    return JONGSEONG_TO_QWERTY[code - 0x11a8 + 1]
  }

  return null
}

function normalizeWordInput(value: string): string {
  if (value.length === 0) {
    return value
  }

  let converted = ''
  let changed = false

  for (const char of value) {
    const mapped = convertHangulCharToQwerty(char)
    if (mapped) {
      converted += mapped
      changed = true
    } else {
      converted += char
    }
  }

  return changed ? converted : value
}

function TagPickerModal({ open, title, nodes, selectedTags, loading, anchorEl, onClose, onApply }: TagPickerModalProps) {
  const flattenedNodes = useMemo(() => flattenTagTree(nodes), [nodes])
  const knownTagPathSet = useMemo(() => new Set(flattenedNodes.map((node) => node.path)), [flattenedNodes])

  const [localSelected, setLocalSelected] = useState<string[]>(() => collapseHierarchicalTags(selectedTags))
  const [searchInput, setSearchInput] = useState('')
  const [newTagInput, setNewTagInput] = useState('')
  const [newTagError, setNewTagError] = useState<string | null>(null)
  const [viewportTick, setViewportTick] = useState(0)

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const handleViewportChange = () => {
      setViewportTick((prev) => prev + 1)
    }

    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [open])

  const anchorRect = useMemo(() => {
    void viewportTick
    return anchorEl?.getBoundingClientRect() ?? null
  }, [anchorEl, viewportTick])

  if (!open) {
    return null
  }

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const viewportGutter = 12
  const panelWidth = Math.min(740, viewportWidth - viewportGutter * 2)
  const estimatedPanelHeight = Math.min(640, viewportHeight - viewportGutter * 2)
  const defaultLeft = Math.max(viewportGutter, Math.round((viewportWidth - panelWidth) / 2))
  const defaultTop = Math.max(viewportGutter, Math.round((viewportHeight - estimatedPanelHeight) / 2))

  let panelLeft = defaultLeft
  let panelTop = defaultTop

  if (anchorRect) {
    const leftFromAnchor = Math.round(anchorRect.left)
    const rightAlignedLeft = Math.round(anchorRect.right - panelWidth)

    if (leftFromAnchor + panelWidth <= viewportWidth - viewportGutter) {
      panelLeft = leftFromAnchor
    } else if (rightAlignedLeft >= viewportGutter) {
      panelLeft = rightAlignedLeft
    } else {
      panelLeft = Math.max(viewportGutter, Math.min(leftFromAnchor, viewportWidth - panelWidth - viewportGutter))
    }

    const belowTop = Math.round(anchorRect.bottom + 8)
    const aboveTop = Math.round(anchorRect.top - estimatedPanelHeight - 8)
    if (belowTop + estimatedPanelHeight <= viewportHeight - viewportGutter) {
      panelTop = belowTop
    } else if (aboveTop >= viewportGutter) {
      panelTop = aboveTop
    } else {
      panelTop = Math.max(viewportGutter, Math.min(Math.round(anchorRect.top), viewportHeight - estimatedPanelHeight - viewportGutter))
    }
  }

  const query = searchInput.trim().toLowerCase()
  const visibleNodes =
    query.length === 0
      ? flattenedNodes
      : flattenedNodes.filter((node) => node.path.toLowerCase().includes(query) || node.name.toLowerCase().includes(query))

  const selectedSet = new Set(localSelected)
  const customSelected = localSelected.filter((tag) => !knownTagPathSet.has(tag))

  const toggleTag = (tagPath: string) => {
    setLocalSelected((prev) => {
      if (prev.includes(tagPath)) {
        return prev.filter((tag) => tag !== tagPath)
      }
      const withoutBranch = prev.filter((tag) => !isSameTagBranch(tag, tagPath))
      return normalizeTagList([...withoutBranch, tagPath])
    })
  }

  const removeSelectedTag = (tagPath: string) => {
    setLocalSelected((prev) => prev.filter((tag) => tag !== tagPath))
  }

  const addNewTag = () => {
    const normalized = normalizeTagPath(newTagInput)
    if (!normalized) {
      setNewTagError('태그 경로를 입력해 주세요.')
      return
    }
    if (normalized.length > MAX_TAG_LEN) {
      setNewTagError(`태그는 ${MAX_TAG_LEN}자 이하로 입력해 주세요.`)
      return
    }

    setLocalSelected((prev) => {
      const withoutBranch = prev.filter((tag) => !isSameTagBranch(tag, normalized))
      return normalizeTagList([...withoutBranch, normalized])
    })
    setNewTagInput('')
    setNewTagError(null)
  }

  const modalContent = (
    <div className="fixed inset-0 z-[80]" onMouseDown={onClose}>
      <div
        className="absolute rounded-2xl border border-sky-200 bg-white shadow-2xl"
        style={{
          left: `${panelLeft}px`,
          top: `${panelTop}px`,
          width: `${panelWidth}px`,
          maxHeight: 'calc(100vh - 24px)',
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-sky-100 px-5 py-4">
          <h3 className="text-base font-bold text-stone-900">{title}</h3>
          <button
            type="button"
            className="rounded-md border border-sky-200 px-2 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-50"
            onClick={onClose}
          >
            닫기
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4" style={{ maxHeight: 'calc(100vh - 128px)' }}>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="태그 검색 (예: 시험/토익)"
              className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
            <button
              type="button"
              className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-50"
              onClick={() => {
                setSearchInput('')
              }}
            >
              검색 초기화
            </button>
          </div>

          <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3">
            <p className="text-xs font-semibold text-sky-800">새 태그 추가</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={newTagInput}
                onChange={(event) => {
                  setNewTagInput(event.target.value)
                  if (newTagError) {
                    setNewTagError(null)
                  }
                }}
                placeholder="예: 시험/토익/LC"
                className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
              <button
                type="button"
                className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-800"
                onClick={addNewTag}
              >
                태그 추가
              </button>
            </div>
            {newTagError && <p className="mt-1 text-xs font-semibold text-rose-600">{newTagError}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="rounded-xl border border-sky-100">
              <p className="border-b border-sky-100 px-3 py-2 text-xs font-semibold text-stone-600">기존 태그 목록</p>
              <div className="max-h-64 space-y-1 overflow-y-auto px-2 py-2">
                {loading && <p className="px-2 py-1 text-xs text-stone-500">태그 불러오는 중...</p>}
                {!loading && visibleNodes.length === 0 && <p className="px-2 py-1 text-xs text-stone-500">표시할 태그가 없습니다.</p>}
                {!loading &&
                  visibleNodes.map((node) => (
                    <label
                      key={`tag-modal-${node.path}`}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-stone-800 transition hover:bg-sky-50"
                      style={{ paddingLeft: `${8 + node.depth * 14}px` }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSet.has(node.path)}
                        onChange={() => toggleTag(node.path)}
                        className="h-4 w-4 rounded border-sky-300 text-sky-700 focus:ring-sky-400"
                      />
                      <span className="truncate">{node.name}</span>
                    </label>
                  ))}
              </div>
            </div>

            <div className="rounded-xl border border-sky-100">
              <p className="border-b border-sky-100 px-3 py-2 text-xs font-semibold text-stone-600">선택된 태그 ({localSelected.length})</p>
              <div className="max-h-64 overflow-y-auto px-3 py-2">
                {localSelected.length === 0 && <p className="text-xs text-stone-500">선택된 태그가 없습니다.</p>}
                {localSelected.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {localSelected.map((tagPath) => (
                      <button
                        key={`selected-tag-${tagPath}`}
                        type="button"
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          customSelected.includes(tagPath) ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'
                        }`}
                        onClick={() => removeSelectedTag(tagPath)}
                        title="클릭해서 제거"
                      >
                        #{tagPath}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-sky-100 px-5 py-4">
          <button
            type="button"
            className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-50"
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-800"
            onClick={() => {
              onApply(collapseHierarchicalTags(localSelected))
              onClose()
            }}
          >
            적용
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}

function AddWordPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const editParam = searchParams.get('edit')
  const editingId = editParam && /^\d+$/.test(editParam) ? Number(editParam) : null
  const isEditing = editingId !== null

  const [, setRecentTags] = useState<string[]>(() => loadRecentTags())
  const [form, setForm] = useState<FormState>(() => ({
    ...EMPTY_FORM,
    tagsText: loadRecentTags().join(', '),
  }))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [entry, setEntry] = useState<EntryResponse | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [loadingItem, setLoadingItem] = useState(false)

  const [suggestions, setSuggestions] = useState<SuggestItem[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [wordFocused, setWordFocused] = useState(false)

  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [showOptionalFields, setShowOptionalFields] = useState(false)
  const [tagTree, setTagTree] = useState<TagTreeNode[]>([])
  const [tagTreeLoading, setTagTreeLoading] = useState(false)
  const [tagTreeRefreshToken, setTagTreeRefreshToken] = useState(0)
  const [tagModalOpen, setTagModalOpen] = useState(false)
  const [tagModalAnchor, setTagModalAnchor] = useState<HTMLButtonElement | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const meaningInputRef = useRef<HTMLTextAreaElement | null>(null)
  const debouncedWord = useDebouncedValue(form.word, 240)

  const wordError = getFieldError(fieldErrors, 'word')
  const meaningError = getFieldError(fieldErrors, 'meaningKo')
  const memoError = getFieldError(fieldErrors, 'memo')
  const tagsError = getFieldError(fieldErrors, 'tags')
  const examplesError = getFieldError(fieldErrors, 'examples')

  const shouldShowSuggest = !isEditing && wordFocused && (suggestLoading || suggestions.length > 0)
  const selectedFormTags = useMemo(() => collapseHierarchicalTags(parseTags(form.tagsText)), [form.tagsText])
  const hasFormPronunciationTag = selectedFormTags.includes(PRONUNCIATION_TAG)

  const redirectToPreviousPage = () => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/list')
  }

  useEffect(() => {
    if (!toast) {
      return undefined
    }

    const timer = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
      }
    }
  }, [])

  useEffect(() => {
    if (editParam && !isEditing) {
      setToast({ type: 'error', message: '잘못된 편집 파라미터입니다.' })
      setSearchParams({})
    }
  }, [editParam, isEditing, setSearchParams])

  useEffect(() => {
    let cancelled = false
    setTagTreeLoading(true)

    apiRequest<TagTreeNode[]>('/api/voca/tags/tree')
      .then((data) => {
        if (!cancelled) {
          setTagTree(data)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTagTree([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTagTreeLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [tagTreeRefreshToken])

  useEffect(() => {
    let cancelled = false

    if (!isEditing) {
      return () => {
        cancelled = true
      }
    }

    setLoadingItem(true)
    setFieldErrors({})
    setSuggestions([])

    apiRequest<VocaResponse>(`/api/voca/${editingId}`)
      .then((item) => {
        if (cancelled) {
          return
        }

        setForm({
          word: item.word,
          meaningKo: item.meaningKo ? toNumberedLines(item.meaningKo) : '',
          memo: item.memo ?? '',
          tagsText: joinTags(item.tags),
          examplesText: joinExamples(item.examples),
        })
        setShowOptionalFields(true)
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        const message = error instanceof ApiError ? error.message : '수정할 단어를 불러오지 못했습니다.'
        setToast({ type: 'error', message })
        setSearchParams({})
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingItem(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [editingId, isEditing, setSearchParams])

  useEffect(() => {
    if (isEditing) {
      setSuggestions([])
      return
    }

    const query = debouncedWord.trim()
    const rawWord = form.word.trim()
    if (query.length === 0) {
      setSuggestions([])
      return
    }
    if (query !== rawWord) {
      return
    }

    let cancelled = false
    setSuggestLoading(true)

    apiRequest<SuggestResponse>(`/api/suggest?q=${encodeURIComponent(query)}&max=${SUGGEST_LIMIT}`)
      .then((data) => {
        if (!cancelled) {
          setSuggestions(data.items)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestions([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSuggestLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [debouncedWord, form.word, isEditing])

  const rememberRecentTags = (usedTags: string[]) => {
    setRecentTags(() => {
      const next = normalizeRecentTags(usedTags)
      saveRecentTags(next)
      return next
    })
  }

  const toggleFormPronunciationTag = () => {
    const nextTags = toggleTagPath(parseTags(form.tagsText), PRONUNCIATION_TAG)
    updateField('tagsText', nextTags.join(', '))
    rememberRecentTags(nextTags)
  }

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))

    const errorKeyMap: Record<keyof FormState, string[]> = {
      word: ['word'],
      meaningKo: ['meaningKo'],
      memo: ['memo'],
      tagsText: ['tags'],
      examplesText: ['examples'],
    }

    const targets = errorKeyMap[key]
    const hasRelatedError = Object.keys(fieldErrors).some((errorKey) =>
      targets.some((target) => errorKey === target || errorKey.startsWith(`${target}[`)),
    )

    if (hasRelatedError) {
      setFieldErrors((prev) => {
        const next = { ...prev }
        Object.keys(next).forEach((errorKey) => {
          if (targets.some((target) => errorKey === target || errorKey.startsWith(`${target}[`))) {
            delete next[errorKey]
          }
        })
        return next
      })
    }
  }

  const playAudio = async (audioUrl: string) => {
    try {
      if (audioRef.current) {
        audioRef.current.pause()
      }

      const audio = new Audio(audioUrl)
      audioRef.current = audio
      await audio.play()
    } catch {
      setToast({ type: 'error', message: '오디오 재생에 실패했습니다.' })
    }
  }

  const lookupEntry = async (word: string, autoFill: boolean, autoFillMeaning = true) => {
    const targetWord = word.trim()
    if (targetWord.length === 0) {
      setToast({ type: 'error', message: '조회할 단어를 입력해 주세요.' })
      return
    }

    setLookupLoading(true)

    try {
      const data = await apiRequest<EntryResponse>(`/api/entry?word=${encodeURIComponent(targetWord)}`)
      setEntry(data)

      if (autoFill) {
        const meaning = data.meaningKo ? clampText(toNumberedLines(data.meaningKo), MAX_MEANING_LEN) : null
        const limitedExamples = data.examples.map((example) => clampText(example, MAX_EXAMPLE_LEN))

        setForm((prev) => ({
          ...prev,
          word: data.word,
          meaningKo: autoFillMeaning ? meaning ?? prev.meaningKo : prev.meaningKo,
          examplesText: limitedExamples.length > 0 ? limitedExamples.join('\n') : prev.examplesText,
        }))
      }

      const hasTruncatedValue =
        (data.meaningKo?.length ?? 0) > MAX_MEANING_LEN || data.examples.some((example) => example.length > MAX_EXAMPLE_LEN)

      setToast({
        type: 'success',
        message: hasTruncatedValue
          ? `"${data.word}" 정보를 불러오고, 저장 제한에 맞게 일부 내용을 줄였습니다.`
          : `"${data.word}" 정보를 불러왔습니다.`,
      })
    } catch (error) {
      setEntry(null)
      if (error instanceof ApiError) {
        setToast({ type: 'error', message: error.message })
      } else {
        setToast({ type: 'error', message: '사전 조회에 실패했습니다.' })
      }
    } finally {
      setLookupLoading(false)
    }
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setFieldErrors({})

    const word = form.word.trim()
    const meaningKo = normalizeMeaningForSave(toNullable(form.meaningKo))
    const memo = toNullable(form.memo)
    const tags = collapseHierarchicalTags(parseTags(form.tagsText))
    const examples = parseExamples(form.examplesText)

    const nextFieldErrors: Record<string, string> = {}
    if (!isEditing) {
      if (word.length === 0) {
        nextFieldErrors.word = '단어는 필수입니다.'
      } else if (word.length > MAX_WORD_LEN) {
        nextFieldErrors.word = `단어는 ${MAX_WORD_LEN}자 이하로 입력해 주세요.`
      }
    }
    if (meaningKo && meaningKo.length > MAX_MEANING_LEN) {
      nextFieldErrors.meaningKo = `뜻은 ${MAX_MEANING_LEN}자 이하로 입력해 주세요.`
    }
    if (memo && memo.length > MAX_MEMO_LEN) {
      nextFieldErrors.memo = `메모는 ${MAX_MEMO_LEN}자 이하로 입력해 주세요.`
    }
    if (tags.some((tag) => tag.length > MAX_TAG_LEN)) {
      nextFieldErrors.tags = `태그는 각각 ${MAX_TAG_LEN}자 이하로 입력해 주세요.`
    }
    if (examples.some((example) => example.length > MAX_EXAMPLE_LEN)) {
      nextFieldErrors.examples = `예문은 한 줄당 ${MAX_EXAMPLE_LEN}자 이하로 입력해 주세요.`
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors)
      if (nextFieldErrors.memo || nextFieldErrors.tags || nextFieldErrors.examples) {
        setShowOptionalFields(true)
      }
      setToast({ type: 'error', message: '입력값을 확인해 주세요.' })
      setSaving(false)
      return
    }

    const commonPayload = {
      meaningKo,
      memo,
      tags,
      examples,
    }

    try {
      if (!isEditing) {
        await apiRequest<VocaResponse>('/api/voca', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            word,
            ...commonPayload,
          }),
        })

        rememberRecentTags(tags)
        setToast({ type: 'success', message: '단어를 추가했습니다.' })
        setForm({
          ...EMPTY_FORM,
          tagsText: tags.join(', '),
        })
        setFieldErrors({})
        setEntry(null)
        setSuggestions([])
        setShowOptionalFields(false)
        setTagTreeRefreshToken((prev) => prev + 1)
      } else {
        await apiRequest<VocaResponse>(`/api/voca/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(commonPayload),
        })

        rememberRecentTags(tags)
        redirectToPreviousPage()
        return
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (Object.keys(error.fieldErrors).length > 0) {
          setFieldErrors(error.fieldErrors)
          const hasOptionalError = Object.keys(error.fieldErrors).some(
            (key) => key === 'memo' || key.startsWith('tags') || key.startsWith('examples'),
          )
          if (hasOptionalError) {
            setShowOptionalFields(true)
          }
          setToast({ type: 'error', message: '입력값을 확인해 주세요.' })
        } else {
          setToast({ type: 'error', message: error.message })
        }
      } else {
        setToast({ type: 'error', message: '저장 중 오류가 발생했습니다. 백엔드 연결 상태를 확인해 주세요.' })
      }
    } finally {
      setSaving(false)
    }
  }

  const applySuggestion = (item: SuggestItem, autoFillMeaning = true) => {
    updateField('word', item.word)
    setEntry(null)
    setWordFocused(false)
    setSuggestions([])
    void lookupEntry(item.word, true, autoFillMeaning)
  }

  const onWordKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.altKey || event.nativeEvent.isComposing) {
      return
    }

    if (!wordFocused || suggestions.length === 0 || suggestLoading) {
      return
    }

    const shortcutIndex = getSuggestionShortcutIndex(event.key)
    if (shortcutIndex !== null) {
      const suggestion = suggestions[shortcutIndex]
      if (!suggestion) {
        return
      }

      event.preventDefault()
      applySuggestion(suggestion, !(event.ctrlKey || event.metaKey))
      return
    }

    if (event.ctrlKey || event.metaKey) {
      return
    }

    if (event.key === 'Tab') {
      const topCompletion = getTopTabCompletion(form.word, suggestions)
      if (!topCompletion) {
        event.preventDefault()
        meaningInputRef.current?.focus()
        return
      }
      event.preventDefault()
      applySuggestion(topCompletion)
      return
    }
  }

  return (
    <section className="animate-fade-up rounded-3xl border-2 border-sky-200 bg-white/95 p-5 shadow-card backdrop-blur-sm [animation-delay:80ms]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-stone-900">{isEditing ? '단어 수정' : '단어 추가'}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-50"
            onClick={() => navigate('/list')}
          >
            목록 페이지
          </button>
          {isEditing && (
            <button
              type="button"
              className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
              onClick={redirectToPreviousPage}
            >
              편집 취소
            </button>
          )}
        </div>
      </div>

      {loadingItem && <p className="mb-3 text-sm text-stone-500">수정할 데이터를 불러오는 중...</p>}

      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="word" className="text-sm font-semibold text-stone-800">
              단어
            </label>
            {!isEditing && (
              <button
                type="button"
                className="text-xs font-semibold text-sky-700 hover:text-sky-900"
                onClick={() => {
                  void lookupEntry(form.word, true)
                }}
                disabled={lookupLoading}
              >
                {lookupLoading ? '조회 중...' : '사전 조회'}
              </button>
            )}
          </div>

          <div className="relative">
            <input
              id="word"
              value={form.word}
              onChange={(event) => {
                updateField('word', normalizeWordInput(event.target.value))
                setEntry(null)
              }}
              onKeyDown={onWordKeyDown}
              onFocus={() => setWordFocused(true)}
              onBlur={() => {
                window.setTimeout(() => setWordFocused(false), 100)
              }}
              lang="en"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={isEditing || loadingItem}
              placeholder={isEditing ? '수정 모드에서는 단어를 변경할 수 없습니다.' : '예: resilient'}
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-stone-100"
            />

            {shouldShowSuggest && (
              <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-sky-200 bg-white shadow-lg">
                {suggestLoading && <p className="px-3 py-2 text-sm text-stone-500">자동완성 불러오는 중...</p>}

                {!suggestLoading && suggestions.length === 0 && (
                  <p className="px-3 py-2 text-sm text-stone-500">추천 단어가 없습니다.</p>
                )}

                {!suggestLoading &&
                  suggestions.map((item, index) => (
                    <button
                      key={item.word}
                      type="button"
                      className="flex w-full items-center justify-between border-b border-sky-50 px-3 py-2 text-left text-sm text-stone-800 transition hover:bg-sky-50"
                      onMouseDown={(event) => {
                        event.preventDefault()
                        applySuggestion(item)
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-[11px] font-semibold text-sky-700">
                          {index + 1}
                        </span>
                        <span className="truncate">{item.word}</span>
                      </span>
                      <span className="text-xs text-stone-500">점수 {item.score ?? '-'}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          {wordError && <p className="mt-1 text-xs font-semibold text-rose-600">{wordError}</p>}
        </div>

        {entry && (
          <div className="animate-fade-up rounded-xl border border-sky-200 bg-sky-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-stone-500">발음 기호</p>
                <p className="font-mono text-sm text-stone-900">{entry.phonetics?.ipa ?? '정보 없음'}</p>
              </div>
              {entry.phonetics?.audioUrl && (
                <button
                  type="button"
                  className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-sky-700"
                  onClick={() => {
                    void playAudio(entry.phonetics?.audioUrl ?? '')
                  }}
                >
                  발음 듣기
                </button>
              )}
            </div>

            {entry.definitionsEn.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-semibold text-stone-500">영문 뜻</p>
                {entry.definitionsEn.slice(0, 3).map((definition) => (
                  <p key={definition} className="text-xs text-stone-700">
                    - {definition}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <label htmlFor="meaningKo" className="mb-1 block text-sm font-semibold text-stone-800">
            뜻(한글)
          </label>
          <textarea
            id="meaningKo"
            ref={meaningInputRef}
            rows={2}
            value={form.meaningKo}
            onChange={(event) => updateField('meaningKo', event.target.value)}
            placeholder="예: 회복력 있는, 탄력적인"
            className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          />
          {meaningError && <p className="mt-1 text-xs font-semibold text-rose-600">{meaningError}</p>}
        </div>

        <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3">
          <button
            type="button"
            className="text-sm font-semibold text-sky-800 underline decoration-dotted underline-offset-2"
            onClick={() => setShowOptionalFields((prev) => !prev)}
          >
            {showOptionalFields ? '추가 입력 접기' : '메모/태그/예문 추가 입력 열기'}
          </button>
          <p className="mt-1 text-xs text-stone-500">필수 입력은 단어와 뜻입니다.</p>
        </div>

        {showOptionalFields && (
          <>
            <div>
              <label htmlFor="memo" className="mb-1 block text-sm font-semibold text-stone-800">
                메모
              </label>
              <textarea
                id="memo"
                rows={2}
                value={form.memo}
                onChange={(event) => updateField('memo', event.target.value)}
                placeholder="암기 팁이나 연상법을 적어두세요."
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
              {memoError && <p className="mt-1 text-xs font-semibold text-rose-600">{memoError}</p>}
            </div>

            <div>
              <label htmlFor="tags" className="mb-1 block text-sm font-semibold text-stone-800">
                태그 (다중/계층, 쉼표 구분)
              </label>
              <input
                id="tags"
                value={form.tagsText}
                onChange={(event) => updateField('tagsText', event.target.value)}
                placeholder="예: 시험/토익/LC, 비즈니스/회의"
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />

              <div className="mt-2 rounded-xl border border-sky-100 bg-sky-50/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-sky-800">태그 선택 모달</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={`rounded-lg border px-3 py-1 text-xs font-semibold transition ${
                        hasFormPronunciationTag
                          ? 'border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                      }`}
                      onClick={toggleFormPronunciationTag}
                    >
                      발음
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-sky-200 bg-white px-3 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-50"
                      onClick={(event) => {
                        setTagModalAnchor(event.currentTarget)
                        setTagModalOpen(true)
                      }}
                    >
                      태그 선택
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedFormTags.length === 0 && <span className="text-xs text-stone-500">선택된 태그가 없습니다.</span>}
                  {selectedFormTags.map((tagPath) => (
                    <span key={`form-selected-${tagPath}`} className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">
                      #{tagPath}
                    </span>
                  ))}
                </div>
              </div>
              {tagsError && <p className="mt-1 text-xs font-semibold text-rose-600">{tagsError}</p>}
            </div>

            <div>
              <label htmlFor="examples" className="mb-1 block text-sm font-semibold text-stone-800">
                예문 (줄바꿈 구분)
              </label>
              <textarea
                id="examples"
                rows={4}
                value={form.examplesText}
                onChange={(event) => updateField('examplesText', event.target.value)}
                placeholder={'예문을 한 줄에 하나씩 입력하세요.\n자동 채우기 시 사전 예문이 들어옵니다.'}
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
              {examplesError && <p className="mt-1 text-xs font-semibold text-rose-600">{examplesError}</p>}
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={saving || loadingItem}
          className="w-full rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-sky-300"
        >
          {saving ? '저장 중...' : isEditing ? '수정 저장' : '단어 저장'}
        </button>
      </form>

      <TagPickerModal
        key={`form-tag-modal-${tagModalOpen ? 'open' : 'closed'}-${selectedFormTags.join('|')}`}
        open={tagModalOpen}
        title="단어 추가 태그 선택"
        nodes={tagTree}
        selectedTags={selectedFormTags}
        loading={tagTreeLoading}
        anchorEl={tagModalAnchor}
        onClose={() => setTagModalOpen(false)}
        onApply={(nextTags) => {
          updateField('tagsText', nextTags.join(', '))
          rememberRecentTags(nextTags)
        }}
      />

      {toast && (
        <div className="pointer-events-none fixed right-4 top-4 z-50 animate-toast">
          <div
            className={`rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${
              toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </section>
  )
}

function BulkAddPage() {
  const navigate = useNavigate()

  const bulkInputRef = useRef<HTMLTextAreaElement | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const [inputText, setInputText] = useState('')
  const [tagsText, setTagsText] = useState(() => loadRecentTags().join(', '))
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [report, setReport] = useState<BulkSaveReport | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [tagTree, setTagTree] = useState<TagTreeNode[]>([])
  const [tagTreeLoading, setTagTreeLoading] = useState(false)
  const [tagTreeRefreshToken, setTagTreeRefreshToken] = useState(0)
  const [tagModalOpen, setTagModalOpen] = useState(false)
  const [tagModalAnchor, setTagModalAnchor] = useState<HTMLButtonElement | null>(null)
  const [bulkCaretContext, setBulkCaretContext] = useState<BulkCaretContext | null>(null)
  const [bulkSuggestQuery, setBulkSuggestQuery] = useState('')
  const [bulkSuggestLoading, setBulkSuggestLoading] = useState(false)
  const [bulkSuggestions, setBulkSuggestions] = useState<SuggestItem[]>([])
  const [bulkSuggestAnchor, setBulkSuggestAnchor] = useState<{ top: number; left: number } | null>(null)
  const [prefetchedApiMeanings, setPrefetchedApiMeanings] = useState<Record<string, string | null>>({})
  const prefetchedLoadingWordsRef = useRef<Set<string>>(new Set())

  const parsed = useMemo(() => parseBulkInput(inputText), [inputText])
  const selectedTags = useMemo(() => collapseHierarchicalTags(parseTags(tagsText)), [tagsText])
  const previewItems = useMemo(() => parsed.entries.slice(0, 200), [parsed.entries])
  const debouncedBulkSuggestQuery = useDebouncedValue(bulkSuggestQuery, 220)
  const hasPronunciationTag = selectedTags.includes(PRONUNCIATION_TAG)
  const tagsError = selectedTags.some((tag) => tag.length > MAX_TAG_LEN) ? `태그는 각각 ${MAX_TAG_LEN}자 이하로 입력해 주세요.` : null
  const canSubmit = !saving && parsed.entries.length > 0 && parsed.issues.length === 0 && !tagsError

  useEffect(() => {
    if (!toast) {
      return undefined
    }

    const timer = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    let cancelled = false
    setTagTreeLoading(true)

    apiRequest<TagTreeNode[]>('/api/voca/tags/tree')
      .then((data) => {
        if (!cancelled) {
          setTagTree(data)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTagTree([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTagTreeLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [tagTreeRefreshToken])

  useEffect(() => {
    const query = debouncedBulkSuggestQuery.trim()
    if (query.length === 0) {
      setBulkSuggestions([])
      setBulkSuggestLoading(false)
      return
    }

    let cancelled = false
    setBulkSuggestLoading(true)

    apiRequest<SuggestResponse>(`/api/suggest?q=${encodeURIComponent(query)}&max=${SUGGEST_LIMIT}`)
      .then((data) => {
        if (!cancelled) {
          setBulkSuggestions(data.items)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBulkSuggestions([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBulkSuggestLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [debouncedBulkSuggestQuery])

  useEffect(() => {
    if (!bulkSuggestAnchor || !bulkInputRef.current) {
      return undefined
    }

    const refreshAnchor = () => {
      if (!bulkInputRef.current) {
        return
      }
      syncBulkSuggestFromPosition(bulkInputRef.current.value, bulkInputRef.current.selectionStart, bulkInputRef.current)
    }

    window.addEventListener('resize', refreshAnchor)
    window.addEventListener('scroll', refreshAnchor, true)

    return () => {
      window.removeEventListener('resize', refreshAnchor)
      window.removeEventListener('scroll', refreshAnchor, true)
    }
  }, [bulkSuggestAnchor])

  useEffect(() => {
    if (!previewScrollRef.current) {
      return
    }
    previewScrollRef.current.scrollTop = previewScrollRef.current.scrollHeight
  }, [previewItems.length, prefetchedApiMeanings])

  const rememberRecentTags = (usedTags: string[]) => {
    const next = normalizeRecentTags(usedTags)
    saveRecentTags(next)
  }

  const toggleBulkPronunciationTag = () => {
    const nextTags = toggleTagPath(parseTags(tagsText), PRONUNCIATION_TAG)
    setTagsText(nextTags.join(', '))
    rememberRecentTags(nextTags)
  }

  const updateBulkSuggestAnchor = (textarea: HTMLTextAreaElement, position: number) => {
    const caret = getTextareaCaretClientPosition(textarea, position)
    if (!caret) {
      setBulkSuggestAnchor(null)
      return
    }

    const panelWidth = 320
    const viewportPadding = 12
    const left = Math.max(viewportPadding, Math.min(caret.left, window.innerWidth - panelWidth - viewportPadding))
    const top = Math.max(viewportPadding, caret.top + caret.lineHeight + 6)
    setBulkSuggestAnchor({
      top: Math.round(top),
      left: Math.round(left),
    })
  }

  const syncBulkSuggestFromPosition = (value: string, position: number, textarea?: HTMLTextAreaElement | null) => {
    const context = getBulkCaretContext(value, position)
    setBulkCaretContext(context)
    if (!context) {
      setBulkSuggestQuery('')
      setBulkSuggestions([])
      setBulkSuggestLoading(false)
      setBulkSuggestAnchor(null)
      return
    }

    const query = context.tokenValue.trim()
    if (query.length === 0) {
      setBulkSuggestQuery('')
      setBulkSuggestions([])
      setBulkSuggestLoading(false)
      setBulkSuggestAnchor(null)
      return
    }

    if (textarea) {
      updateBulkSuggestAnchor(textarea, position)
    }
    setBulkSuggestQuery(query)
  }

  const prefetchApiMeaning = async (word: string) => {
    const normalizedWord = normalizeWordInput(word.trim())
    if (normalizedWord.length === 0) {
      return
    }

    const key = normalizedWord.toLowerCase()
    if (Object.prototype.hasOwnProperty.call(prefetchedApiMeanings, key)) {
      return
    }
    if (prefetchedLoadingWordsRef.current.has(key)) {
      return
    }

    prefetchedLoadingWordsRef.current.add(key)
    const entryData = await lookupEntryWithRetry(normalizedWord)
    const normalizedMeaning =
      entryData?.meaningKo && entryData.meaningKo.trim().length > 0
        ? normalizeMeaningForSave(clampText(toNumberedLines(entryData.meaningKo), MAX_MEANING_LEN))
        : null

    setPrefetchedApiMeanings((prev) => ({
      ...prev,
      [key]: normalizedMeaning,
    }))
    prefetchedLoadingWordsRef.current.delete(key)
  }

  const focusBulkInputAt = (position: number, nextValue: string) => {
    requestAnimationFrame(() => {
      if (!bulkInputRef.current) {
        return
      }
      const nextPos = Math.max(0, Math.min(position, nextValue.length))
      bulkInputRef.current.focus()
      bulkInputRef.current.setSelectionRange(nextPos, nextPos)
      syncBulkSuggestFromPosition(nextValue, nextPos, bulkInputRef.current)
    })
  }

  const replaceBulkRange = (start: number, end: number, replacement: string): string => {
    return `${inputText.slice(0, start)}${replacement}${inputText.slice(end)}`
  }

  const applyBulkSuggestion = (item: SuggestItem, prefetchMeaning = true) => {
    if (!bulkCaretContext || saving) {
      return
    }
    const nextValue = replaceBulkRange(bulkCaretContext.tokenStart, bulkCaretContext.tokenEnd, item.word)
    const nextCaret = bulkCaretContext.tokenStart + item.word.length
    setInputText(nextValue)
    setBulkSuggestions([])
    setBulkSuggestLoading(false)
    focusBulkInputAt(nextCaret, nextValue)
    if (prefetchMeaning) {
      void prefetchApiMeaning(item.word)
    }
  }

  const insertTabAtCaret = (target: HTMLTextAreaElement) => {
    const start = target.selectionStart
    const end = target.selectionEnd
    const nextValue = `${inputText.slice(0, start)}\t${inputText.slice(end)}`
    const nextCaret = start + 1
    setInputText(nextValue)
    focusBulkInputAt(nextCaret, nextValue)
  }

  const buildPrefilledLine = async (lineValue: string): Promise<string> => {
    const trimmed = lineValue.trim()
    if (trimmed.length === 0) {
      return lineValue
    }

    const delimiterIndex = findBulkDelimiterIndex(lineValue)
    if (delimiterIndex < 0 && lineValue.includes(',')) {
      return lineValue
    }

    const rawWord = normalizeWordInput((delimiterIndex >= 0 ? lineValue.slice(0, delimiterIndex) : lineValue).trim())
    const rawMeaning = delimiterIndex >= 0 ? lineValue.slice(delimiterIndex + 1).trim() : ''
    if (rawWord.length === 0) {
      return lineValue
    }

    const entryData = await lookupEntryWithRetry(rawWord)
    const resolvedWord = normalizeWordInput((entryData?.word ?? rawWord).trim()) || rawWord

    const normalizedMeaning = parseBulkMeaningOverride(rawMeaning)
    if (normalizedMeaning) {
      return `${resolvedWord}\t${formatMeaningForBulkLine(normalizedMeaning)}`
    }

    const entryMeaning = entryData?.meaningKo ? formatMeaningForBulkLine(entryData.meaningKo) : ''
    if (entryMeaning.length > 0) {
      return `${resolvedWord}\t${entryMeaning}`
    }

    if (delimiterIndex >= 0) {
      return `${resolvedWord}\t`
    }
    return resolvedWord
  }

  const prefillCurrentLineAndInsertNewLine = async (target: HTMLTextAreaElement) => {
    if (saving) {
      return
    }
    const caret = target.selectionStart
    const { lineStart, lineEnd, lineValue } = findLineRangeAtPosition(inputText, caret)
    const nextLineValue = await buildPrefilledLine(lineValue)
    const nextValue = `${inputText.slice(0, lineStart)}${nextLineValue}\n${inputText.slice(lineEnd)}`
    const nextCaret = lineStart + nextLineValue.length + 1
    setInputText(nextValue)
    focusBulkInputAt(nextCaret, nextValue)
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) {
      return
    }

    setFormError(null)
    setReport(null)

    if (parsed.issues.length > 0) {
      setFormError('입력 형식 오류를 먼저 수정해 주세요.')
      return
    }
    if (parsed.entries.length === 0) {
      setFormError('추가할 단어를 입력해 주세요.')
      return
    }
    if (tagsError) {
      setFormError(tagsError)
      return
    }

    const tags = collapseHierarchicalTags(parseTags(tagsText))
    setSaving(true)
    setProgress({ current: 0, total: parsed.entries.length })

    let successCount = 0
    const failures: BulkSaveFailure[] = []

    for (let index = 0; index < parsed.entries.length; index += 1) {
      const item = parsed.entries[index]
      setProgress({ current: index + 1, total: parsed.entries.length })

      const requestedWord = item.word.trim()
      if (requestedWord.length === 0) {
        failures.push({
          key: item.key,
          lineNo: item.lineNo,
          word: item.word,
          message: '단어가 비어 있습니다.',
        })
        continue
      }
      if (requestedWord.length > MAX_WORD_LEN) {
        failures.push({
          key: item.key,
          lineNo: item.lineNo,
          word: requestedWord,
          message: `단어는 ${MAX_WORD_LEN}자 이하로 입력해 주세요.`,
        })
        continue
      }

      const entryData = await lookupEntryWithRetry(requestedWord)
      const resolvedWord = normalizeWordInput((entryData?.word ?? requestedWord).trim())
      if (resolvedWord.length === 0) {
        failures.push({
          key: item.key,
          lineNo: item.lineNo,
          word: requestedWord,
          message: '단어를 해석하지 못했습니다.',
        })
        continue
      }
      if (resolvedWord.length > MAX_WORD_LEN) {
        failures.push({
          key: item.key,
          lineNo: item.lineNo,
          word: resolvedWord,
          message: `단어는 ${MAX_WORD_LEN}자 이하로 입력해 주세요.`,
        })
        continue
      }

      let meaningKo = item.meaningOverride
      if (!meaningKo && entryData?.meaningKo && entryData.meaningKo.trim().length > 0) {
        const limitedMeaning = clampText(toNumberedLines(entryData.meaningKo), MAX_MEANING_LEN)
        meaningKo = normalizeMeaningForSave(limitedMeaning)
      }

      if (meaningKo && meaningKo.length > MAX_MEANING_LEN) {
        failures.push({
          key: item.key,
          lineNo: item.lineNo,
          word: resolvedWord,
          message: `뜻은 ${MAX_MEANING_LEN}자 이하로 입력해 주세요.`,
        })
        continue
      }

      const examples = normalizeExamplesForSave(entryData?.examples ?? [])

      try {
        await apiRequest<VocaResponse>('/api/voca', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            word: resolvedWord,
            meaningKo,
            tags,
            examples,
          }),
        })
        successCount += 1
      } catch (error) {
        if (error instanceof ApiError) {
          const fieldMessage = error.fieldErrors.word ?? error.fieldErrors.meaningKo ?? error.fieldErrors.examples ?? error.message
          failures.push({
            key: item.key,
            lineNo: item.lineNo,
            word: resolvedWord,
            message: fieldMessage,
          })
        } else {
          failures.push({
            key: item.key,
            lineNo: item.lineNo,
            word: resolvedWord,
            message: '저장 중 오류가 발생했습니다.',
          })
        }
      }
    }

    const nextReport: BulkSaveReport = {
      total: parsed.entries.length,
      successCount,
      failedCount: failures.length,
      failures,
    }

    setReport(nextReport)
    setProgress(null)
    setSaving(false)
    setTagTreeRefreshToken((prev) => prev + 1)

    if (successCount > 0) {
      rememberRecentTags(tags)
      if (failures.length === 0) {
        setToast({ type: 'success', message: `${successCount}개 단어를 추가했습니다.` })
        setInputText('')
      } else {
        setToast({ type: 'error', message: `${successCount}개 추가, ${failures.length}개 실패` })
      }
    } else {
      setToast({ type: 'error', message: '추가된 단어가 없습니다. 실패 사유를 확인해 주세요.' })
    }
  }

  const getPreviewMeaningLabel = (item: BulkParsedEntry): string => {
    if (item.meaningOverride) {
      return `입력 뜻 우선: ${formatMeaningForBulkLine(item.meaningOverride)}`
    }

    const key = item.word.toLowerCase()
    if (Object.prototype.hasOwnProperty.call(prefetchedApiMeanings, key)) {
      const prefetchedMeaning = prefetchedApiMeanings[key]
      return prefetchedMeaning ? `API 뜻(미리조회): ${formatMeaningForBulkLine(prefetchedMeaning)}` : 'API 뜻 없음'
    }

    return 'API 뜻 사용'
  }

  return (
    <section className="animate-fade-up rounded-3xl border-2 border-sky-200 bg-white/95 p-5 shadow-card backdrop-blur-sm [animation-delay:120ms]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-stone-900">여러 단어 추가</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-50"
            onClick={() => navigate('/add')}
          >
            단일 추가
          </button>
          <button
            type="button"
            className="rounded-lg border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-50"
            onClick={() => navigate('/list')}
          >
            목록 페이지
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-sm text-stone-700">
        <p className="font-semibold text-sky-800">입력 규칙</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-stone-600">
          <li>단어만 입력: 쉼표 또는 줄바꿈으로 여러 개 입력</li>
          <li>단어+뜻 입력: `단어 + TAB + 뜻` 또는 `단어|뜻`</li>
          <li>뜻이 여러 개인 경우 `;`로 구분 (예: `resilient|회복력 있는;탄력 있는`)</li>
          <li>`Tab` 입력 시 실제 탭 문자가 들어가고, `Enter` 입력 시 현재 줄을 미리 불러온 뒤 다음 줄로 이동</li>
        </ul>
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <label htmlFor="bulk-input" className="mb-1 block text-sm font-semibold text-stone-800">
            일괄 입력
          </label>
          <textarea
            id="bulk-input"
            ref={bulkInputRef}
            rows={12}
            value={inputText}
            onChange={(event) => {
              const nextValue = event.target.value
              setInputText(nextValue)
              if (formError) {
                setFormError(null)
              }
              syncBulkSuggestFromPosition(nextValue, event.currentTarget.selectionStart, event.currentTarget)
            }}
            onClick={(event) => {
              syncBulkSuggestFromPosition(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget)
            }}
            onSelect={(event) => {
              syncBulkSuggestFromPosition(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget)
            }}
            onKeyUp={(event) => {
              syncBulkSuggestFromPosition(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget)
            }}
            onScroll={(event) => {
              syncBulkSuggestFromPosition(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget)
            }}
            onBlur={() => {
              window.setTimeout(() => {
                setBulkSuggestions([])
                setBulkSuggestLoading(false)
                setBulkSuggestQuery('')
                setBulkSuggestAnchor(null)
              }, 100)
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return
              }

              if (event.key === 'Escape') {
                setBulkSuggestions([])
                setBulkSuggestLoading(false)
                setBulkSuggestQuery('')
                setBulkSuggestAnchor(null)
                return
              }

              const shortcutIndex = getSuggestionShortcutIndex(event.key)
              if (shortcutIndex !== null && bulkSuggestions[shortcutIndex]) {
                event.preventDefault()
                applyBulkSuggestion(bulkSuggestions[shortcutIndex], !(event.ctrlKey || event.metaKey))
                return
              }

              if (event.ctrlKey || event.metaKey || event.altKey) {
                return
              }

              if (event.key === 'Tab') {
                event.preventDefault()
                insertTabAtCaret(event.currentTarget)
                return
              }

              if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'Enter') {
                event.preventDefault()
                void prefillCurrentLineAndInsertNewLine(event.currentTarget)
              }
            }}
            placeholder={'resilient, meticulous\nubiquitous\t어디에나 있는\ntake off|이륙하다;벗다'}
            disabled={saving}
            className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-stone-100"
          />
          {bulkSuggestAnchor && (bulkSuggestLoading || bulkSuggestions.length > 0) && (
            <div
              className="fixed z-[90] overflow-hidden rounded-xl border border-sky-200 bg-white shadow-lg"
              style={{
                top: `${bulkSuggestAnchor?.top ?? 0}px`,
                left: `${bulkSuggestAnchor?.left ?? 0}px`,
                width: '320px',
                maxWidth: 'calc(100vw - 24px)',
              }}
            >
              <p className="border-b border-sky-100 px-3 py-2 text-xs font-semibold text-stone-600">
                현재 입력 단어 추천 {bulkCaretContext ? `( ${bulkCaretContext.lineNo}행 )` : ''}
              </p>
              {bulkSuggestLoading && <p className="px-3 py-2 text-sm text-stone-500">자동완성 불러오는 중...</p>}
              {!bulkSuggestLoading && bulkSuggestions.length === 0 && <p className="px-3 py-2 text-sm text-stone-500">추천 단어가 없습니다.</p>}
              {!bulkSuggestLoading &&
                bulkSuggestions.map((item, index) => (
                  <button
                    key={`bulk-suggest-${item.word}`}
                    type="button"
                    className="flex w-full items-center justify-between border-b border-sky-50 px-3 py-2 text-left text-sm text-stone-800 transition hover:bg-sky-50"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applyBulkSuggestion(item)
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-[11px] font-semibold text-sky-700">
                        {index + 1}
                      </span>
                      <span className="truncate">{item.word}</span>
                    </span>
                    <span className="text-xs text-stone-500">점수 {item.score ?? '-'}</span>
                  </button>
                ))}
            </div>
          )}

          <div className="mt-3 rounded-xl border border-sky-100 bg-white p-3">
            <p className="text-sm font-semibold text-stone-800">미리보기</p>
            {previewItems.length === 0 && <p className="mt-2 text-xs text-stone-500">입력된 항목이 없습니다.</p>}
            {previewItems.length > 0 && (
              <div ref={previewScrollRef} className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-sky-100">
                <table className="w-full border-collapse text-left text-xs text-stone-700">
                  <thead className="sticky top-0 bg-sky-50">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-stone-700">행</th>
                      <th className="px-3 py-2 font-semibold text-stone-700">단어</th>
                      <th className="px-3 py-2 font-semibold text-stone-700">뜻 처리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewItems.map((item) => (
                      <tr key={`bulk-preview-${item.key}`} className="border-t border-sky-50">
                        <td className="px-3 py-2">{item.lineNo}</td>
                        <td className="px-3 py-2 font-semibold text-stone-900">{item.word}</td>
                        <td className="px-3 py-2">{getPreviewMeaningLabel(item)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {parsed.entries.length > previewItems.length && (
              <p className="mt-2 text-xs text-stone-500">미리보기는 처음 {previewItems.length}개 항목만 표시합니다.</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="bulk-tags" className="mb-1 block text-sm font-semibold text-stone-800">
            공통 태그 (선택)
          </label>
          <input
            id="bulk-tags"
            value={tagsText}
            onChange={(event) => setTagsText(event.target.value)}
            disabled={saving}
            placeholder="예: 시험/토익/LC, 비즈니스/회의"
            className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-stone-100"
          />

          <div className="mt-2 rounded-xl border border-sky-100 bg-sky-50/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-sky-800">태그 선택 모달</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={`rounded-lg border px-3 py-1 text-xs font-semibold transition ${
                    hasPronunciationTag
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  }`}
                  onClick={toggleBulkPronunciationTag}
                  disabled={saving}
                >
                  발음
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-sky-200 bg-white px-3 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-50"
                  onClick={(event) => {
                    setTagModalAnchor(event.currentTarget)
                    setTagModalOpen(true)
                  }}
                  disabled={saving}
                >
                  태그 선택
                </button>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {selectedTags.length === 0 && <span className="text-xs text-stone-500">선택된 태그가 없습니다.</span>}
              {selectedTags.map((tagPath) => (
                <span key={`bulk-selected-${tagPath}`} className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">
                  #{tagPath}
                </span>
              ))}
            </div>
          </div>

          {tagsError && <p className="mt-1 text-xs font-semibold text-rose-600">{tagsError}</p>}
        </div>

        <div className="rounded-xl border border-sky-100 bg-white p-3">
          <p className="text-sm font-semibold text-stone-800">파싱 결과</p>
          <p className="mt-1 text-xs text-stone-600">
            유효 항목 {parsed.entries.length}개 / 형식 오류 {parsed.issues.length}개 / 중복 제거 {parsed.duplicateRemoved}개 (같은 단어는 마지막 입력 우선)
          </p>
          {parsed.issues.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-rose-700">
              {parsed.issues.slice(0, 8).map((issue) => (
                <li key={`bulk-issue-${issue.lineNo}-${issue.value}`}>
                  {issue.lineNo}행: {issue.message}
                </li>
              ))}
              {parsed.issues.length > 8 && <li>외 {parsed.issues.length - 8}개 오류</li>}
            </ul>
          )}
        </div>

        {formError && <p className="text-xs font-semibold text-rose-600">{formError}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-sky-300"
        >
          {saving
            ? `${progress?.current ?? 0}/${progress?.total ?? parsed.entries.length} 처리 중...`
            : `일괄 추가 (${parsed.entries.length}개)`}
        </button>
      </form>

      {report && (
        <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/60 p-3">
          <p className="text-sm font-semibold text-stone-800">
            실행 결과: 총 {report.total}개 중 성공 {report.successCount}개 / 실패 {report.failedCount}개
          </p>
          {report.failures.length > 0 && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-rose-700">
              {report.failures.map((failure) => (
                <li key={`bulk-failure-${failure.key}`}>
                  {failure.lineNo}행 `{failure.word}`: {failure.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <TagPickerModal
        key={`bulk-tag-modal-${tagModalOpen ? 'open' : 'closed'}-${selectedTags.join('|')}`}
        open={tagModalOpen}
        title="여러 단어 추가 태그 선택"
        nodes={tagTree}
        selectedTags={selectedTags}
        loading={tagTreeLoading}
        anchorEl={tagModalAnchor}
        onClose={() => setTagModalOpen(false)}
        onApply={(nextTags) => {
          setTagsText(nextTags.join(', '))
          rememberRecentTags(nextTags)
        }}
      />

      {toast && (
        <div className="pointer-events-none fixed right-4 top-4 z-50 animate-toast">
          <div
            className={`rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${
              toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </section>
  )
}

function WordListPage() {
  const navigate = useNavigate()

  const [keywordInput, setKeywordInput] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [groupByDate, setGroupByDate] = useState(false)
  const [page, setPage] = useState(0)
  const [pageData, setPageData] = useState<PageResponse<VocaResponse> | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [listRefreshToken, setListRefreshToken] = useState(0)
  const [openExampleIds, setOpenExampleIds] = useState<Record<number, boolean>>({})
  const [expandedMeaningIds, setExpandedMeaningIds] = useState<Record<number, boolean>>({})
  const [expandedMemoIds, setExpandedMemoIds] = useState<Record<number, boolean>>({})
  const [showCardTags, setShowCardTags] = useState(true)
  const [showCardExamples, setShowCardExamples] = useState(true)
  const [showCardActions, setShowCardActions] = useState(true)
  const [displayOptionsOpen, setDisplayOptionsOpen] = useState(false)
  const [tagTree, setTagTree] = useState<TagTreeNode[]>([])
  const [tagTreeLoading, setTagTreeLoading] = useState(false)
  const [, setRecentTags] = useState<string[]>(() => loadRecentTags())
  const [quickTags, setQuickTags] = useState<string[]>(() => loadRecentTags())
  const [quickTagModalOpen, setQuickTagModalOpen] = useState(false)
  const [quickTagModalAnchor, setQuickTagModalAnchor] = useState<HTMLButtonElement | null>(null)
  const [quickWord, setQuickWord] = useState('')
  const [quickMeaning, setQuickMeaning] = useState('')
  const [quickExamples, setQuickExamples] = useState<string[]>([])
  const [quickSaving, setQuickSaving] = useState(false)
  const [quickLookupLoading, setQuickLookupLoading] = useState(false)
  const [quickSuggestions, setQuickSuggestions] = useState<SuggestItem[]>([])
  const [quickSuggestLoading, setQuickSuggestLoading] = useState(false)
  const [quickWordFocused, setQuickWordFocused] = useState(false)
  const [quickError, setQuickError] = useState<string | null>(null)
  const [editingMeaningId, setEditingMeaningId] = useState<number | null>(null)
  const [editingMeaningText, setEditingMeaningText] = useState('')
  const [editingMeaningSaving, setEditingMeaningSaving] = useState(false)
  const [editingMeaningError, setEditingMeaningError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const quickMeaningInputRef = useRef<HTMLInputElement | null>(null)
  const displayOptionsRef = useRef<HTMLDivElement | null>(null)

  const debouncedKeyword = useDebouncedValue(keywordInput, 300)
  const debouncedTag = useDebouncedValue(tagInput, 300)
  const debouncedQuickWord = useDebouncedValue(quickWord, 240)
  const quickInlineSuggestion = useMemo(() => {
    if (!quickWordFocused || quickWord.length === 0 || quickSuggestLoading || quickSuggestions.length === 0) {
      return null
    }

    const topWord = quickSuggestions[0]?.word ?? ''
    if (!topWord || topWord.length <= quickWord.length) {
      return null
    }

    if (!topWord.toLowerCase().startsWith(quickWord.toLowerCase())) {
      return null
    }

    return topWord
  }, [quickWord, quickWordFocused, quickSuggestLoading, quickSuggestions])
  const hasQuickPronunciationTag = quickTags.includes(PRONUNCIATION_TAG)
  const groupedByDateItems = useMemo(() => {
    const groups: Array<{ key: string; label: string; items: VocaResponse[] }> = []
    const groupMap = new Map<string, { key: string; label: string; items: VocaResponse[] }>()

    ;(pageData?.items ?? []).forEach((item) => {
      const key = getLocalDateKey(item.createdAt)
      if (!groupMap.has(key)) {
        const nextGroup = { key, label: formatDateGroupLabel(key), items: [] as VocaResponse[] }
        groupMap.set(key, nextGroup)
        groups.push(nextGroup)
      }
      groupMap.get(key)?.items.push(item)
    })

    return groups
  }, [pageData?.items])

  const itemCount = pageData?.items.length ?? 0
  const totalElements = pageData?.totalElements ?? 0
  const totalPages = pageData?.totalPages ?? 0

  const pageNumbers = useMemo(() => buildPageNumbers(page, totalPages), [page, totalPages])

  useEffect(() => {
    if (!toast) {
      return undefined
    }

    const timer = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
      }
    }
  }, [])

  useEffect(() => {
    if (!displayOptionsOpen) {
      return undefined
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!displayOptionsRef.current) {
        return
      }
      if (!displayOptionsRef.current.contains(event.target as Node)) {
        setDisplayOptionsOpen(false)
      }
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDisplayOptionsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [displayOptionsOpen])

  useEffect(() => {
    let cancelled = false

    async function fetchList() {
      setListLoading(true)
      const params = new URLSearchParams({
        page: String(page),
        size: String(PAGE_SIZE),
      })

      const keyword = debouncedKeyword.trim()
      const tag = debouncedTag.trim()

      if (keyword.length > 0) {
        params.set('keyword', keyword)
      }
      if (tag.length > 0) {
        params.set('tag', tag)
      }

      try {
        const data = await apiRequest<PageResponse<VocaResponse>>(`/api/voca?${params.toString()}`)
        if (cancelled) {
          return
        }

        setPageData(data)

        if (data.totalPages === 0 && page !== 0) {
          setPage(0)
          return
        }

        if (data.totalPages > 0 && page >= data.totalPages) {
          setPage(data.totalPages - 1)
        }
      } catch (error) {
        if (!cancelled) {
          if (error instanceof ApiError) {
            setToast({ type: 'error', message: error.message })
          } else {
            setToast({ type: 'error', message: '목록을 불러오지 못했습니다.' })
          }
        }
      } finally {
        if (!cancelled) {
          setListLoading(false)
        }
      }
    }

    void fetchList()

    return () => {
      cancelled = true
    }
  }, [page, debouncedKeyword, debouncedTag, listRefreshToken])

  useEffect(() => {
    let cancelled = false
    setTagTreeLoading(true)

    apiRequest<TagTreeNode[]>('/api/voca/tags/tree')
      .then((data) => {
        if (!cancelled) {
          setTagTree(data)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTagTree([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTagTreeLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [listRefreshToken])

  useEffect(() => {
    const query = debouncedQuickWord.trim()
    const rawWord = quickWord.trim()
    if (query.length === 0) {
      setQuickSuggestions([])
      setQuickSuggestLoading(false)
      return
    }
    if (query !== rawWord) {
      return
    }

    let cancelled = false
    setQuickSuggestLoading(true)

    apiRequest<SuggestResponse>(`/api/suggest?q=${encodeURIComponent(query)}&max=${SUGGEST_LIMIT}`)
      .then((data) => {
        if (!cancelled) {
          setQuickSuggestions(data.items)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQuickSuggestions([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setQuickSuggestLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [debouncedQuickWord, quickWord])

  const playAudio = async (audioUrl: string) => {
    try {
      if (audioRef.current) {
        audioRef.current.pause()
      }

      const audio = new Audio(audioUrl)
      audioRef.current = audio
      await audio.play()
    } catch {
      setToast({ type: 'error', message: '오디오 재생에 실패했습니다.' })
    }
  }

  const deleteItem = async (item: VocaResponse) => {
    const shouldDelete = window.confirm(`"${item.word}" 단어를 삭제할까요?`)
    if (!shouldDelete) {
      return
    }

    try {
      await apiRequest<void>(`/api/voca/${item.id}`, { method: 'DELETE' })
      setToast({ type: 'success', message: '단어를 삭제했습니다.' })
      setListRefreshToken((prev) => prev + 1)
      setOpenExampleIds((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
      setExpandedMeaningIds((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
      setExpandedMemoIds((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
    } catch (error) {
      if (error instanceof ApiError) {
        setToast({ type: 'error', message: error.message })
      } else {
        setToast({ type: 'error', message: '삭제 중 오류가 발생했습니다.' })
      }
    }
  }

  const fillQuickMeaningFromEntry = async (word: string, fallbackMeaning = '', autoFillMeaning = true) => {
    const target = word.trim()
    if (target.length === 0) {
      return { word: '', meaning: fallbackMeaning.trim(), examples: [] as string[] }
    }

    setQuickLookupLoading(true)
    try {
      const data = await lookupEntryWithRetry(target)
      if (!data) {
        setQuickExamples([])
        return { word: target, meaning: fallbackMeaning.trim(), examples: [] as string[] }
      }
      setQuickWord(data.word)

      let nextMeaning = fallbackMeaning.trim()
      if (data.meaningKo && data.meaningKo.trim().length > 0) {
        const apiMeaning = clampText(toNumberedLines(data.meaningKo), MAX_MEANING_LEN)
        if (autoFillMeaning) {
          nextMeaning = apiMeaning
          setQuickMeaning(nextMeaning)
        }
      }
      const nextExamples = normalizeExamplesForSave(data.examples ?? [])
      setQuickExamples(nextExamples)
      setQuickError(null)
      return { word: data.word, meaning: nextMeaning, examples: nextExamples }
    } catch {
      // 빠른 추가에서는 조회 실패를 치명 오류로 보지 않음(직접 입력 가능)
      setQuickExamples([])
      return { word: target, meaning: fallbackMeaning.trim(), examples: [] as string[] }
    } finally {
      setQuickLookupLoading(false)
    }
  }

  const saveQuickEntry = async (rawWord: string, rawMeaning: string, rawExamples: string[] = quickExamples) => {
    const word = rawWord.trim()
    const meaning = normalizeMeaningForSave(rawMeaning)
    const examples = normalizeExamplesForSave(rawExamples)
    const selectedTags = collapseHierarchicalTags(quickTags)

    if (word.length === 0) {
      setQuickError('단어를 입력해 주세요.')
      return false
    }
    if (word.length > MAX_WORD_LEN) {
      setQuickError(`단어는 ${MAX_WORD_LEN}자 이하로 입력해 주세요.`)
      return false
    }
    if (meaning && meaning.length > MAX_MEANING_LEN) {
      setQuickError(`뜻은 ${MAX_MEANING_LEN}자 이하로 입력해 주세요.`)
      return false
    }
    if (selectedTags.some((tag) => tag.length > MAX_TAG_LEN)) {
      setQuickError(`태그는 각각 ${MAX_TAG_LEN}자 이하로 입력해 주세요.`)
      return false
    }

    setQuickSaving(true)
    setQuickError(null)

    try {
      let examplesToSave = examples
      if (examplesToSave.length === 0) {
        const entryData = await lookupEntryWithRetry(word)
        if (entryData) {
          examplesToSave = normalizeExamplesForSave(entryData.examples ?? [])
        }
      }

      await apiRequest<VocaResponse>('/api/voca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word,
          meaningKo: meaning,
          tags: selectedTags,
          examples: examplesToSave,
        }),
      })

      setRecentTags(() => {
        const next = normalizeRecentTags(selectedTags)
        saveRecentTags(next)
        return next
      })
      setQuickWord('')
      setQuickMeaning('')
      setQuickExamples([])
      setQuickTags(selectedTags)
      setQuickTagModalOpen(false)
      setQuickTagModalAnchor(null)
      setQuickSuggestions([])
      setQuickWordFocused(false)
      setToast({ type: 'success', message: '목록에서 단어를 추가했습니다.' })
      setPage(0)
      setListRefreshToken((prev) => prev + 1)
      return true
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldMessage = error.fieldErrors.word ?? error.fieldErrors.meaningKo
        setQuickError(fieldMessage ?? error.message)
      } else {
        setQuickError('추가 중 오류가 발생했습니다.')
      }
      return false
    } finally {
      setQuickSaving(false)
    }
  }

  const toggleQuickPronunciationTag = () => {
    setQuickTags((prev) => {
      const nextTags = toggleTagPath(prev, PRONUNCIATION_TAG)
      setRecentTags(() => {
        const recentNext = normalizeRecentTags(nextTags)
        saveRecentTags(recentNext)
        return recentNext
      })
      return nextTags
    })
  }

  const onQuickAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (quickSaving || quickLookupLoading) {
      if (quickLookupLoading) {
        setQuickError('단어 정보를 불러오는 중입니다. 잠시 후 다시 추가해 주세요.')
      }
      return
    }
    await saveQuickEntry(quickWord, quickMeaning)
  }

  const applyQuickSuggestion = async (item: SuggestItem, autoSave: boolean, autoFillMeaning = true) => {
    if (quickSaving) {
      return
    }

    const currentMeaning = quickMeaning
    const selectedWord = item.word
    setQuickWord(selectedWord)
    setQuickExamples([])
    setQuickWordFocused(false)
    setQuickSuggestions([])
    const resolved = await fillQuickMeaningFromEntry(selectedWord, currentMeaning, autoFillMeaning)

    if (autoSave) {
      const resolvedWord = resolved.word.length > 0 ? resolved.word : selectedWord
      await saveQuickEntry(resolvedWord, resolved.meaning, resolved.examples)
    }
  }

  const onQuickWordKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.altKey || event.nativeEvent.isComposing) {
      return
    }

    const canUseSuggestions = quickWordFocused && quickSuggestions.length > 0 && !quickSuggestLoading

    if (!canUseSuggestions) {
      return
    }

    const shortcutIndex = getSuggestionShortcutIndex(event.key)
    if (shortcutIndex !== null) {
      const suggestion = quickSuggestions[shortcutIndex]
      if (!suggestion) {
        return
      }

      event.preventDefault()
      const skipMeaningAutoFill = event.ctrlKey || event.metaKey
      void applyQuickSuggestion(suggestion, !skipMeaningAutoFill, !skipMeaningAutoFill)
      return
    }

    if (event.ctrlKey || event.metaKey) {
      return
    }

    if (event.key === 'Tab') {
      const topCompletion = getTopTabCompletion(quickWord, quickSuggestions)
      if (!topCompletion) {
        event.preventDefault()
        quickMeaningInputRef.current?.focus()
        return
      }
      event.preventDefault()
      void applyQuickSuggestion(topCompletion, true)
      return
    }
  }

  const applyTagFilter = (tagPath: string) => {
    setTagInput(tagPath)
    setPage(0)
  }

  const startMeaningInlineEdit = (item: VocaResponse) => {
    if (editingMeaningSaving) {
      return
    }
    setEditingMeaningId(item.id)
    setEditingMeaningText(item.meaningKo ? toNumberedLines(item.meaningKo) : '')
    setEditingMeaningError(null)
  }

  const cancelMeaningInlineEdit = () => {
    if (editingMeaningSaving) {
      return
    }
    setEditingMeaningId(null)
    setEditingMeaningText('')
    setEditingMeaningError(null)
  }

  const saveMeaningInlineEdit = async (item: VocaResponse) => {
    if (editingMeaningSaving || editingMeaningId !== item.id) {
      return
    }
    const normalizedMeaning = normalizeMeaningForSave(editingMeaningText)
    if ((normalizedMeaning?.length ?? 0) > MAX_MEANING_LEN) {
      setEditingMeaningError(`뜻은 ${MAX_MEANING_LEN}자 이하로 입력해 주세요.`)
      return
    }

    setEditingMeaningSaving(true)
    setEditingMeaningError(null)

    try {
      const updated = await apiRequest<VocaResponse>(`/api/voca/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meaningKo: normalizedMeaning ?? '',
        }),
      })

      setPageData((prev) => {
        if (!prev) {
          return prev
        }
        return {
          ...prev,
          items: prev.items.map((entry) => (entry.id === item.id ? { ...entry, meaningKo: updated.meaningKo, updatedAt: updated.updatedAt } : entry)),
        }
      })
      setEditingMeaningId(null)
      setEditingMeaningText('')
      setToast({ type: 'success', message: '뜻을 수정했습니다.' })
    } catch (error) {
      if (error instanceof ApiError) {
        const message = error.fieldErrors.meaningKo ?? error.message
        setEditingMeaningError(message)
      } else {
        setEditingMeaningError('뜻 수정 중 오류가 발생했습니다.')
      }
    } finally {
      setEditingMeaningSaving(false)
    }
  }

  const renderWordCard = (item: VocaResponse) => {
    const tags = item.tags ?? []
    const examples = item.examples ?? []
    const shouldShowTags = showCardTags && tags.length > 0
    const shouldShowExamples = showCardExamples && examples.length > 0
    const isExamplesOpen = Boolean(openExampleIds[item.id])
    const isMeaningEditing = editingMeaningId === item.id
    const meaningLines = parseMeaningLines(item.meaningKo)
    const meaningText = meaningLines.join('\n')
    const meaningNeedsToggle =
      meaningLines.length > COLLAPSED_MEANING_LINE_LIMIT || (meaningText.length > 0 && isLongText(meaningText, 120, 3))
    const isMeaningExpanded = Boolean(expandedMeaningIds[item.id])
    const visibleMeaningLines =
      meaningNeedsToggle && !isMeaningExpanded ? meaningLines.slice(0, COLLAPSED_MEANING_LINE_LIMIT) : meaningLines
    const memoText = item.memo ?? ''
    const memoNeedsToggle = Boolean(item.memo) && isLongText(memoText, 90, 2)
    const isMemoExpanded = Boolean(expandedMemoIds[item.id])

    return (
      <article key={item.id} className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="nanum-gothic-bold text-xl text-stone-900">{item.word}</h3>
              {item.ipa && (
                <button
                  type="button"
                  className={`font-mono text-sm ${
                    item.audioUrl
                      ? 'text-sky-700 underline decoration-dotted underline-offset-2 hover:text-sky-900'
                      : 'cursor-default text-stone-500'
                  }`}
                  onClick={() => {
                    if (item.audioUrl) {
                      void playAudio(item.audioUrl)
                    }
                  }}
                  disabled={!item.audioUrl}
                  title={item.audioUrl ? '클릭해서 발음 듣기' : '오디오 없음'}
                >
                  [{item.ipa}]
                </button>
              )}

              {showCardActions && (
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-50"
                    onClick={() => navigate(`/add?edit=${item.id}`)}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-sky-300 bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-900 transition hover:bg-sky-200"
                    onClick={() => {
                      void deleteItem(item)
                    }}
                  >
                    삭제
                  </button>
                </div>
              )}
            </div>

            {!isMeaningEditing && (
              <>
                {visibleMeaningLines.length > 0 ? (
                  <div
                    className="mt-1 flex cursor-text flex-wrap items-start gap-2"
                    onDoubleClick={() => startMeaningInlineEdit(item)}
                    title="뜻을 더블클릭해서 빠르게 수정"
                  >
                    {visibleMeaningLines.map((line, index) =>
                      isMeaningChipLine(line) ? (
                        <span
                          key={`meaning-chip-${item.id}-${index}`}
                          className="rounded-full px-2 py-1 text-sm text-stone-700 whitespace-nowrap"
                        >
                          {line}
                        </span>
                      ) : (
                        <p
                          key={`meaning-line-${item.id}-${index}`}
                          className="w-full px-1 py-1 text-sm text-stone-700 whitespace-pre-line"
                        >
                          {line}
                        </p>
                      ),
                    )}
                  </div>
                ) : (
                  <p
                    className="mt-1 cursor-text text-sm text-stone-500"
                    onDoubleClick={() => startMeaningInlineEdit(item)}
                    title="뜻을 더블클릭해서 빠르게 수정"
                  >
                    뜻이 아직 없습니다.
                  </p>
                )}
                {meaningNeedsToggle && (
                  <button
                    type="button"
                    className="mt-1 text-xs font-semibold text-sky-700 underline decoration-dotted underline-offset-2 hover:text-sky-900"
                    onClick={() =>
                      setExpandedMeaningIds((prev) => ({
                        ...prev,
                        [item.id]: !prev[item.id],
                      }))
                    }
                  >
                    {isMeaningExpanded ? '뜻 접기' : '뜻 더보기'}
                  </button>
                )}
              </>
            )}

            {isMeaningEditing && (
              <div className="mt-1 rounded-xl border border-sky-200 bg-sky-50/60 p-2">
                <textarea
                  value={editingMeaningText}
                  onChange={(event) => {
                    setEditingMeaningText(event.target.value)
                    if (editingMeaningError) {
                      setEditingMeaningError(null)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelMeaningInlineEdit()
                      return
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void saveMeaningInlineEdit(item)
                    }
                  }}
                  rows={3}
                  autoFocus
                  className="w-full rounded-lg border border-sky-200 bg-white px-2 py-1 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                  placeholder="뜻을 입력하세요"
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-stone-300 px-2 py-1 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
                    onClick={cancelMeaningInlineEdit}
                    disabled={editingMeaningSaving}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-sky-700 px-2 py-1 text-xs font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-sky-300"
                    onClick={() => {
                      void saveMeaningInlineEdit(item)
                    }}
                    disabled={editingMeaningSaving}
                  >
                    {editingMeaningSaving ? '저장 중...' : '저장'}
                  </button>
                </div>
                {editingMeaningError && <p className="mt-1 text-xs font-semibold text-rose-600">{editingMeaningError}</p>}
              </div>
            )}

            {shouldShowTags && (
              <div className="mt-3 flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={`${item.id}-${tag}`}
                    type="button"
                    className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-200"
                    onClick={() => applyTagFilter(tag)}
                    title={`#${tag} 태그로 검색`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {(shouldShowExamples || item.memo) && (
            <div className="mt-3">
              {shouldShowExamples && (
                <div>
                  <button
                    type="button"
                    className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-100"
                    onClick={() => {
                      setOpenExampleIds((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                    }}
                  >
                    {isExamplesOpen ? '예문 접기' : `예문 ${examples.length}개 보기`}
                  </button>

                  {isExamplesOpen && (
                    <div className="mt-2 rounded-xl bg-sky-50 px-3 py-2">
                      <ul className="space-y-1 text-sm text-sky-900/90">
                        {examples.map((example) => (
                          <li key={`${item.id}-${example}`}>- {example}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {item.memo && (
                <div className="mt-3">
                  <p
                    className={`rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900 ${
                      memoNeedsToggle && !isMemoExpanded ? 'line-clamp-2' : 'whitespace-pre-line'
                    }`}
                  >
                    {item.memo}
                  </p>
                  {memoNeedsToggle && (
                    <button
                      type="button"
                      className="mt-1 text-xs font-semibold text-sky-700 underline decoration-dotted underline-offset-2 hover:text-sky-900"
                      onClick={() =>
                        setExpandedMemoIds((prev) => ({
                          ...prev,
                          [item.id]: !prev[item.id],
                        }))
                      }
                    >
                      {isMemoExpanded ? '메모 접기' : '메모 더보기'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </article>
    )
  }

  return (
    <section className="animate-fade-up rounded-3xl border-2 border-sky-200 bg-white/95 p-5 shadow-card backdrop-blur-sm [animation-delay:160ms]">
      <div className="flex flex-col gap-4 border-b border-sky-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-stone-900">단어 목록</h2>
          <p className="text-sm text-stone-500">현재 {itemCount}개 표시 / 전체 {totalElements}개</p>
        </div>

        <div className="w-full max-w-3xl space-y-2">
          <form
            className="grid gap-2 sm:grid-cols-[minmax(200px,0.95fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            onSubmit={onQuickAdd}
          >
            <div className="h-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs text-stone-900">
              <div className="flex h-full items-center justify-between gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left outline-none transition hover:text-sky-900"
                  onClick={(event) => {
                    setQuickTagModalAnchor(event.currentTarget)
                    setQuickTagModalOpen(true)
                  }}
                  disabled={quickSaving}
                >
                  <p className="font-semibold text-sky-800">태그 선택</p>
                  <p className="mt-1 truncate text-stone-500">{quickTags.length > 0 ? `${quickTags.length}개 선택됨` : '선택된 태그 없음'}</p>
                </button>
                <button
                  type="button"
                  className={`shrink-0 whitespace-nowrap rounded-lg border px-2 py-1 font-semibold transition ${
                    hasQuickPronunciationTag
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  }`}
                  onClick={toggleQuickPronunciationTag}
                  disabled={quickSaving}
                  title="클릭 시 발음 태그를 추가/제거합니다."
                >
                  발음
                </button>
              </div>
            </div>

            <div className="relative h-full">
              {quickInlineSuggestion && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center rounded-xl px-3 py-2 text-sm leading-5">
                  <span className="whitespace-pre text-transparent">{quickWord}</span>
                  <span className="truncate text-stone-400">{quickInlineSuggestion.slice(quickWord.length)}</span>
                </div>
              )}
              <input
                value={quickWord}
                onChange={(event) => {
                  setQuickWord(normalizeWordInput(event.target.value))
                  setQuickExamples([])
                  if (quickError) {
                    setQuickError(null)
                  }
                }}
                onKeyDown={onQuickWordKeyDown}
                onFocus={() => setQuickWordFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => setQuickWordFocused(false), 100)
                }}
                lang="en"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="단어"
                disabled={quickSaving}
                className="relative z-20 h-full w-full rounded-xl border border-sky-200 bg-transparent px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-stone-100"
              />

              {quickWordFocused && (quickSuggestLoading || quickSuggestions.length > 0) && (
                <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-sky-200 bg-white shadow-lg">
                  {quickSuggestLoading && <p className="px-3 py-2 text-sm text-stone-500">자동완성 불러오는 중...</p>}

                  {!quickSuggestLoading &&
                    quickSuggestions.map((item, index) => (
                      <button
                        key={`quick-${item.word}`}
                        type="button"
                        className="flex w-full items-center justify-between border-b border-sky-50 px-3 py-2 text-left text-sm text-stone-800 transition hover:bg-sky-50"
                        onMouseDown={(event) => {
                          event.preventDefault()
                          void applyQuickSuggestion(item, false)
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-[11px] font-semibold text-sky-700">
                            {index + 1}
                          </span>
                          <span className="truncate">{item.word}</span>
                        </span>
                        <span className="text-xs text-stone-500">점수 {item.score ?? '-'}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <input
              ref={quickMeaningInputRef}
              value={quickMeaning}
              onChange={(event) => setQuickMeaning(event.target.value)}
              placeholder="뜻"
              disabled={quickSaving || quickLookupLoading}
              className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-stone-100"
            />
            <button
              type="submit"
              disabled={quickSaving || quickLookupLoading}
              className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-sky-300"
            >
              {quickSaving ? '추가 중...' : quickLookupLoading ? '조회 중...' : '추가'}
            </button>
          </form>

          {quickTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {quickTags.map((tagPath) => (
                <span key={`quick-selected-${tagPath}`} className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">
                  #{tagPath}
                </span>
              ))}
            </div>
          )}
          {quickError && <p className="text-xs font-semibold text-rose-600">{quickError}</p>}
        </div>
      </div>

      <div className="mt-4 grid w-full gap-2 sm:grid-cols-2">
        <input
          value={keywordInput}
          onChange={(event) => {
            setKeywordInput(event.target.value)
            setPage(0)
          }}
          placeholder="단어/뜻/메모 즉시검색"
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        />
        <input
          value={tagInput}
          onChange={(event) => {
            setTagInput(event.target.value)
            setPage(0)
          }}
          placeholder="태그 검색"
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        />
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <div className="relative" ref={displayOptionsRef}>
          <button
            type="button"
            className={`rounded-lg border px-3 py-1 text-xs font-semibold transition ${
              displayOptionsOpen
                ? 'border-sky-400 bg-sky-100 text-sky-900'
                : 'border-sky-200 bg-white text-sky-800 hover:bg-sky-50'
            }`}
            onClick={() => setDisplayOptionsOpen((prev) => !prev)}
            aria-expanded={displayOptionsOpen}
          >
            옵션
          </button>
          {displayOptionsOpen && (
            <div className="absolute right-0 z-40 mt-2 w-48 rounded-xl border border-sky-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-xs font-semibold text-stone-500">표시 항목</p>
              <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-stone-800">
                <input type="checkbox" checked={showCardTags} onChange={(event) => setShowCardTags(event.target.checked)} />
                태그
              </label>
              <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-stone-800">
                <input type="checkbox" checked={showCardExamples} onChange={(event) => setShowCardExamples(event.target.checked)} />
                예문
              </label>
              <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-stone-800">
                <input type="checkbox" checked={showCardActions} onChange={(event) => setShowCardActions(event.target.checked)} />
                수정/삭제
              </label>
            </div>
          )}
        </div>
        <div className="inline-flex rounded-lg border border-sky-200 bg-white p-1">
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
              !groupByDate ? 'bg-sky-700 text-white' : 'text-sky-800 hover:bg-sky-50'
            }`}
            onClick={() => setGroupByDate(false)}
          >
            일반 보기
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
              groupByDate ? 'bg-sky-700 text-white' : 'text-sky-800 hover:bg-sky-50'
            }`}
            onClick={() => setGroupByDate(true)}
          >
            날짜별 묶어보기
          </button>
        </div>
      </div>

      <div className="mt-4">
        {listLoading && <p className="text-sm text-stone-500">목록 불러오는 중...</p>}

        {!listLoading && pageData?.items.length === 0 && (
          <p className="rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500">
            검색 조건에 맞는 단어가 없습니다.
          </p>
        )}

        {!listLoading && (pageData?.items.length ?? 0) > 0 && (
          <>
            {!groupByDate && <div className="grid gap-4 sm:grid-cols-2">{(pageData?.items ?? []).map((item) => renderWordCard(item))}</div>}

            {groupByDate && (
              <div className="space-y-5">
                {groupedByDateItems.map((group) => (
                  <section key={group.key}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-sky-800">{group.label}</h3>
                      <span className="rounded-full bg-sky-100 px-2 py-1 text-[11px] font-semibold text-sky-800">{group.items.length}개</span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">{group.items.map((item) => renderWordCard(item))}</div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {totalPages > 1 && (
        <nav className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-stone-300 px-3 py-1 text-sm text-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setPage((prev) => Math.max(0, prev - 1))}
            disabled={page === 0}
          >
            이전
          </button>

          {pageNumbers.map((pageNo) => (
            <button
              key={pageNo}
              type="button"
              className={`rounded-lg px-3 py-1 text-sm font-semibold transition ${
                pageNo === page ? 'bg-sky-700 text-white' : 'border border-stone-300 text-stone-700 hover:bg-stone-100'
              }`}
              onClick={() => setPage(pageNo)}
            >
              {pageNo + 1}
            </button>
          ))}

          <button
            type="button"
            className="rounded-lg border border-stone-300 px-3 py-1 text-sm text-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
            disabled={page >= totalPages - 1}
          >
            다음
          </button>
        </nav>
      )}

      <TagPickerModal
        key={`quick-tag-modal-${quickTagModalOpen ? 'open' : 'closed'}-${quickTags.join('|')}`}
        open={quickTagModalOpen}
        title="빠른 추가 태그 선택"
        nodes={tagTree}
        selectedTags={quickTags}
        loading={tagTreeLoading}
        anchorEl={quickTagModalAnchor}
        onClose={() => setQuickTagModalOpen(false)}
        onApply={(nextTags) => {
          setQuickTags(nextTags)
          setRecentTags(() => {
            const next = normalizeRecentTags(nextTags)
            saveRecentTags(next)
            return next
          })
        }}
      />

      {toast && (
        <div className="pointer-events-none fixed right-4 top-4 z-50 animate-toast">
          <div
            className={`rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${
              toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </section>
  )
}

function App() {
  return (
    <div className="nanum-gothic-regular min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="animate-fade-up rounded-3xl border border-sky-100 bg-white/85 px-6 py-6 shadow-card backdrop-blur-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <NavLink to="/list" className="inline-block">
              <h1 className="text-5xl font-extrabold tracking-[0.08em] text-sky-700 sm:text-6xl">VOCA NOTE</h1>
            </NavLink>
            <div className="flex flex-col gap-2 sm:items-end">
              <div className="flex flex-col gap-2">
                <NavLink
                  to="/add"
                  className={({ isActive }) =>
                    `rounded-lg px-4 py-2 text-sm font-semibold transition ${
                      isActive ? 'bg-sky-700 text-white' : 'border border-sky-200 text-sky-800 hover:bg-sky-50'
                    }`
                  }
                >
                  단어 추가
                </NavLink>
                <NavLink
                  to="/add/bulk"
                  className={({ isActive }) =>
                    `rounded-lg px-4 py-2 text-sm font-semibold transition ${
                      isActive ? 'bg-sky-700 text-white' : 'border border-sky-200 text-sky-800 hover:bg-sky-50'
                    }`
                  }
                >
                  여러 단어 추가
                </NavLink>
                <NavLink
                  to="/list"
                  className={({ isActive }) =>
                    `rounded-lg px-4 py-2 text-sm font-semibold transition ${
                      isActive ? 'bg-sky-700 text-white' : 'border border-sky-200 text-sky-800 hover:bg-sky-50'
                    }`
                  }
                >
                  단어 목록
                </NavLink>
              </div>
            </div>
          </div>
        </header>

        {/* 기존 별도 네비게이션 대신 헤더 우측 바로가기로 통합 */}
        <nav className="hidden">
          <div>
            <NavLink
              to="/add"
              className={({ isActive }) =>
                `rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  isActive ? 'bg-sky-700 text-white' : 'border border-sky-200 text-sky-800 hover:bg-sky-50'
                }`
              }
            >
              단어 추가
            </NavLink>
            <NavLink
              to="/add/bulk"
              className={({ isActive }) =>
                `rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  isActive ? 'bg-sky-700 text-white' : 'border border-sky-200 text-sky-800 hover:bg-sky-50'
                }`
              }
            >
              여러 단어 추가
            </NavLink>
            <NavLink
              to="/list"
              className={({ isActive }) =>
                `rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  isActive ? 'bg-sky-700 text-white' : 'border border-sky-200 text-sky-800 hover:bg-sky-50'
                }`
              }
            >
              단어 목록
            </NavLink>
          </div>
        </nav>

        <Routes>
          <Route path="/" element={<Navigate to="/add" replace />} />
          <Route path="/add" element={<AddWordPage />} />
          <Route path="/add/bulk" element={<BulkAddPage />} />
          <Route path="/list" element={<WordListPage />} />
          <Route path="*" element={<Navigate to="/add" replace />} />
        </Routes>
      </div>
    </div>
  )
}

export default App
