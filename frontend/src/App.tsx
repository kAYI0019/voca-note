import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, JSX, KeyboardEvent } from 'react'
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
const TAG_PREFERENCES_STORAGE_KEY = 'voca-note:tag-preferences:v1'
const WORD_LIST_STUDY_MASK_MODE_STORAGE_KEY = 'voca-note:list-study-mask-mode:v1'
const WORD_LIST_RANDOM_ORDER_STORAGE_KEY = 'voca-note:list-random-order:v1'
const WORD_LIST_VIEW_STATE_STORAGE_KEY = 'voca-note:list-view-state:v1'
const WORD_LIST_FAVORITE_MIGRATION_DONE_STORAGE_KEY = 'voca-note:list-favorite-migration-done:v1'
const LEGACY_WORD_LIST_REVIEW_TARGET_IDS_STORAGE_KEY = 'voca-note:list-review-target-ids:v1'
const LEGACY_WORD_LIST_REVIEW_ONLY_STORAGE_KEY = 'voca-note:list-review-only:v1'
const NAVER_DICTIONARY_ICON_URL = 'https://s.pstatic.net/static/www/nFavicon96.png'
const PRONUNCIATION_TAG = '발음'
const ROOT_TAG_PARENT_KEY = '__root__'

type ToastType = 'success' | 'error'
type StudyMaskMode = 'off' | 'hideWord' | 'hideMeaning'
type StudyScoreResult = 'CORRECT' | 'PARTIAL' | 'WRONG'
type TagDropPosition = 'before' | 'after'
type RevealByMaskMode = {
  hideWord: Record<number, boolean>
  hideMeaning: Record<number, boolean>
}

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
  favorite: boolean
  studyCorrectCount: number
  studyPartialCount: number
  studyWrongCount: number
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

interface TagPreferenceMeta {
  alias: string | null
  favorite: boolean
}

interface TagPreferencesState {
  metadataByPath: Record<string, TagPreferenceMeta>
  customTags: string[]
  orderByParent: Record<string, string[]>
}

interface TagPreferencesController {
  nodes: TagTreeNode[]
  metadataByPath: Record<string, TagPreferenceMeta>
  favoriteTags: string[]
  serverTagPaths: Set<string>
  registerTagPath: (tagPath: string) => void
  registerTagPaths: (tagPaths: string[]) => void
  toggleFavorite: (tagPath: string) => void
  setFavorite: (tagPath: string, favorite: boolean) => void
  setAlias: (tagPath: string, alias: string) => { ok: boolean; error?: string }
  removeLocalTag: (tagPath: string) => void
  setSiblingOrder: (parentPath: string, orderedChildPaths: string[]) => void
  sortTags: (tagPaths: string[]) => string[]
  getChipLabel: (tagPath: string) => string
  getTreeLabel: (tagPath: string, fallbackName: string) => string
  getAlias: (tagPath: string) => string | null
  resolveExactAlias: (value: string) => string | null
  isLocalOnlyLeafTag: (tagPath: string) => boolean
}

interface TagPickerModalProps {
  open: boolean
  title: string
  selectedTags: string[]
  loading: boolean
  anchorEl: HTMLElement | null
  tagPreferences: TagPreferencesController
  onClose: () => void
  onApply: (tags: string[]) => void
}

interface TagManagementModalProps {
  open: boolean
  nodes: TagTreeNode[]
  metadataByPath: Record<string, TagPreferenceMeta>
  serverTagPaths: Set<string>
  onClose: () => void
  onRegisterTagPath: (tagPath: string) => void
  onSetFavorite: (tagPath: string, favorite: boolean) => void
  onSetAlias: (tagPath: string, alias: string) => { ok: boolean; error?: string }
  onRemoveLocalTag: (tagPath: string) => void
  onSetSiblingOrder: (parentPath: string, orderedChildPaths: string[]) => void
  getChipLabel: (tagPath: string) => string
  getTreeLabel: (tagPath: string, fallbackName: string) => string
  getAlias: (tagPath: string) => string | null
  isLocalOnlyLeafTag: (tagPath: string) => boolean
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

interface WordListViewState {
  keywordInput: string
  tagInput: string
  groupByDate: boolean
  showFavoritesOnly: boolean
  favoriteFirst: boolean
  showCardTags: boolean
  showCardExamples: boolean
  showCardActions: boolean
  showStudyScoreSummary: boolean
  showStudyScoreButtons: boolean
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

const DEFAULT_WORD_LIST_VIEW_STATE: WordListViewState = {
  keywordInput: '',
  tagInput: '',
  groupByDate: false,
  showFavoritesOnly: false,
  favoriteFirst: false,
  showCardTags: true,
  showCardExamples: true,
  showCardActions: true,
  showStudyScoreSummary: true,
  showStudyScoreButtons: true,
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

const EMPTY_TAG_PREFERENCES: TagPreferencesState = {
  metadataByPath: {},
  customTags: [],
  orderByParent: {},
}

function getTagOrderKey(parentPath: string): string {
  return parentPath.length > 0 ? parentPath : ROOT_TAG_PARENT_KEY
}

function getTagParentPath(tagPath: string): string {
  const normalized = normalizeTagPath(tagPath)
  if (!normalized) {
    return ''
  }
  const delimiterIndex = normalized.lastIndexOf('/')
  return delimiterIndex >= 0 ? normalized.slice(0, delimiterIndex) : ''
}

function getTagLeafName(tagPath: string): string {
  const normalized = normalizeTagPath(tagPath)
  if (!normalized) {
    return tagPath
  }
  const segments = normalized.split('/')
  return segments[segments.length - 1] ?? normalized
}

function normalizeAliasInput(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeAliasKey(value: string): string {
  return value.trim().toLocaleLowerCase('ko-KR')
}

function sanitizeTagPreferences(raw: TagPreferencesState | null | undefined): TagPreferencesState {
  if (!raw) {
    return EMPTY_TAG_PREFERENCES
  }

  const metadataByPath = Object.entries(raw.metadataByPath ?? {}).reduce<Record<string, TagPreferenceMeta>>((acc, [rawPath, rawMeta]) => {
    const path = normalizeTagPath(rawPath)
    if (!path || !rawMeta || typeof rawMeta !== 'object') {
      return acc
    }

    const meta = rawMeta as Partial<TagPreferenceMeta>
    const alias = typeof meta.alias === 'string' ? normalizeAliasInput(meta.alias) : null
    const favorite = Boolean(meta.favorite)
    if (!alias && !favorite) {
      return acc
    }

    acc[path] = {
      alias,
      favorite,
    }
    return acc
  }, {})

  const customTags = normalizeTagList(Array.isArray(raw.customTags) ? raw.customTags.filter((item): item is string => typeof item === 'string') : [])

  const orderByParent = Object.entries(raw.orderByParent ?? {}).reduce<Record<string, string[]>>((acc, [rawParentPath, rawOrder]) => {
    const normalizedParentPath = rawParentPath === ROOT_TAG_PARENT_KEY ? '' : normalizeTagPath(rawParentPath)
    if (normalizedParentPath === null) {
      return acc
    }

    const normalizedOrder = normalizeTagList(
      Array.isArray(rawOrder) ? rawOrder.filter((item): item is string => typeof item === 'string') : [],
    )

    if (normalizedOrder.length > 0) {
      acc[getTagOrderKey(normalizedParentPath ?? '')] = normalizedOrder
    }
    return acc
  }, {})

  return {
    metadataByPath,
    customTags,
    orderByParent,
  }
}

function loadTagPreferences(): TagPreferencesState {
  if (typeof window === 'undefined') {
    return EMPTY_TAG_PREFERENCES
  }

  try {
    const raw = window.localStorage.getItem(TAG_PREFERENCES_STORAGE_KEY)
    if (!raw) {
      return EMPTY_TAG_PREFERENCES
    }

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return EMPTY_TAG_PREFERENCES
    }

    return sanitizeTagPreferences(parsed as TagPreferencesState)
  } catch {
    return EMPTY_TAG_PREFERENCES
  }
}

function saveTagPreferences(preferences: TagPreferencesState): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(TAG_PREFERENCES_STORAGE_KEY, JSON.stringify(sanitizeTagPreferences(preferences)))
  } catch {
    // localStorage 접근 실패시 태그 메타데이터 저장을 생략한다.
  }
}

function collectTagPaths(nodes: TagTreeNode[]): string[] {
  const collected: string[] = []

  const visit = (node: TagTreeNode) => {
    collected.push(node.path)
    node.children.forEach(visit)
  }

  nodes.forEach(visit)
  return collected
}

function buildOrderedTagTree(tagPaths: string[], orderByParent: Record<string, string[]>): TagTreeNode[] {
  type MutableTagNode = {
    path: string
    name: string
    depth: number
    childrenByPath: Map<string, MutableTagNode>
  }

  const root: MutableTagNode = {
    path: '',
    name: '',
    depth: -1,
    childrenByPath: new Map<string, MutableTagNode>(),
  }

  normalizeTagList(tagPaths).forEach((tagPath) => {
    const segments = tagPath.split('/')
    let currentNode = root
    let currentPath = ''

    segments.forEach((segment, index) => {
      currentPath = currentPath.length > 0 ? `${currentPath}/${segment}` : segment
      const existing = currentNode.childrenByPath.get(currentPath)
      if (existing) {
        currentNode = existing
        return
      }

      const nextNode: MutableTagNode = {
        path: currentPath,
        name: segment,
        depth: index,
        childrenByPath: new Map<string, MutableTagNode>(),
      }
      currentNode.childrenByPath.set(currentPath, nextNode)
      currentNode = nextNode
    })
  })

  const toNodeList = (parentNode: MutableTagNode): TagTreeNode[] => {
    const manualOrder = orderByParent[getTagOrderKey(parentNode.path)] ?? []
    const children = [...parentNode.childrenByPath.values()]
    const manualOrderSet = new Set(manualOrder)
    const manuallyOrderedChildren = manualOrder
      .map((path) => parentNode.childrenByPath.get(path))
      .filter((node): node is MutableTagNode => Boolean(node))
    const remainingChildren = children
      .filter((node) => !manualOrderSet.has(node.path))
      .sort((left, right) => left.name.localeCompare(right.name, 'ko-KR') || left.path.localeCompare(right.path, 'ko-KR'))

    return [...manuallyOrderedChildren, ...remainingChildren].map((node) => ({
      path: node.path,
      name: node.name,
      depth: node.depth,
      children: toNodeList(node),
    }))
  }

  return toNodeList(root)
}

function buildTagOrderIndex(nodes: TagTreeNode[]): Map<string, number> {
  return collectTagPaths(nodes).reduce<Map<string, number>>((acc, path, index) => {
    acc.set(path, index)
    return acc
  }, new Map<string, number>())
}

function sortTagsByDisplayOrder(tagPaths: string[], orderIndex: Map<string, number>): string[] {
  return normalizeTagList(tagPaths).sort((left, right) => {
    const leftIndex = orderIndex.get(left)
    const rightIndex = orderIndex.get(right)

    if (typeof leftIndex === 'number' && typeof rightIndex === 'number' && leftIndex !== rightIndex) {
      return leftIndex - rightIndex
    }
    if (typeof leftIndex === 'number') {
      return -1
    }
    if (typeof rightIndex === 'number') {
      return 1
    }

    return left.localeCompare(right, 'ko-KR')
  })
}

function reorderSiblingPaths(currentOrder: string[], sourcePath: string, targetPath: string, position: TagDropPosition): string[] {
  if (sourcePath === targetPath) {
    return currentOrder
  }

  const nextOrder = currentOrder.filter((path) => path !== sourcePath)
  const targetIndex = nextOrder.indexOf(targetPath)
  if (targetIndex < 0) {
    return currentOrder
  }

  const insertionIndex = position === 'after' ? targetIndex + 1 : targetIndex
  nextOrder.splice(insertionIndex, 0, sourcePath)
  return nextOrder
}

function filterTagTreeByQuery(
  nodes: TagTreeNode[],
  rawQuery: string,
  metadataByPath: Record<string, TagPreferenceMeta>,
): { nodes: TagTreeNode[]; autoExpandedPaths: Set<string> } {
  const query = rawQuery.trim().toLocaleLowerCase('ko-KR')
  if (query.length === 0) {
    return {
      nodes,
      autoExpandedPaths: new Set<string>(),
    }
  }

  const autoExpandedPaths = new Set<string>()

  const visit = (node: TagTreeNode): TagTreeNode | null => {
    const alias = metadataByPath[node.path]?.alias?.toLocaleLowerCase('ko-KR') ?? ''
    const selfMatches =
      node.path.toLocaleLowerCase('ko-KR').includes(query) ||
      node.name.toLocaleLowerCase('ko-KR').includes(query) ||
      alias.includes(query)

    const matchedChildren = node.children
      .map((child) => visit(child))
      .filter((child): child is TagTreeNode => Boolean(child))

    if (!selfMatches && matchedChildren.length === 0) {
      return null
    }

    if (matchedChildren.length > 0) {
      autoExpandedPaths.add(node.path)
    }

    return {
      ...node,
      children: matchedChildren,
    }
  }

  return {
    nodes: nodes.map((node) => visit(node)).filter((node): node is TagTreeNode => Boolean(node)),
    autoExpandedPaths,
  }
}

function getTagChipLabel(tagPath: string, metadataByPath: Record<string, TagPreferenceMeta>): string {
  return metadataByPath[tagPath]?.alias ?? tagPath
}

function getTagTreeLabel(tagPath: string, fallbackName: string, metadataByPath: Record<string, TagPreferenceMeta>): string {
  return metadataByPath[tagPath]?.alias ?? fallbackName
}

function resolveTagPathByExactAlias(value: string, metadataByPath: Record<string, TagPreferenceMeta>): string | null {
  const alias = normalizeAliasInput(value)
  if (!alias) {
    return null
  }

  const matchedEntry = Object.entries(metadataByPath).find(([, meta]) => {
    if (!meta.alias) {
      return false
    }
    return normalizeAliasKey(meta.alias) === normalizeAliasKey(alias)
  })

  return matchedEntry?.[0] ?? null
}

function useTagPreferences(serverNodes: TagTreeNode[]): TagPreferencesController {
  const [preferences, setPreferences] = useState<TagPreferencesState>(() => loadTagPreferences())

  useEffect(() => {
    saveTagPreferences(preferences)
  }, [preferences])

  const serverTagPaths = useMemo(() => new Set(collectTagPaths(serverNodes)), [serverNodes])
  const allKnownTagPaths = useMemo(
    () => normalizeTagList([...collectTagPaths(serverNodes), ...preferences.customTags, ...Object.keys(preferences.metadataByPath)]),
    [preferences.customTags, preferences.metadataByPath, serverNodes],
  )
  const nodes = useMemo(() => buildOrderedTagTree(allKnownTagPaths, preferences.orderByParent), [allKnownTagPaths, preferences.orderByParent])
  const orderIndex = useMemo(() => buildTagOrderIndex(nodes), [nodes])
  const nodeMap = useMemo(() => {
    const entries = new Map<string, TagTreeNode>()
    const visit = (node: TagTreeNode) => {
      entries.set(node.path, node)
      node.children.forEach(visit)
    }
    nodes.forEach(visit)
    return entries
  }, [nodes])

  const updatePreferences = (updater: (prev: TagPreferencesState) => TagPreferencesState) => {
    setPreferences((prev) => sanitizeTagPreferences(updater(prev)))
  }

  const registerTagPaths = (tagPaths: string[]) => {
    const normalizedLocalTags = normalizeTagList(tagPaths).filter((path) => !serverTagPaths.has(path))
    if (normalizedLocalTags.length === 0) {
      return
    }

    updatePreferences((prev) => ({
      ...prev,
      customTags: normalizeTagList([...prev.customTags, ...normalizedLocalTags]),
    }))
  }

  const registerTagPath = (tagPath: string) => {
    registerTagPaths([tagPath])
  }

  const setFavorite = (tagPath: string, favorite: boolean) => {
    const normalized = normalizeTagPath(tagPath)
    if (!normalized) {
      return
    }

    updatePreferences((prev) => {
      const current = prev.metadataByPath[normalized] ?? { alias: null, favorite: false }
      const nextMetadataByPath = { ...prev.metadataByPath }
      if (favorite || current.alias) {
        nextMetadataByPath[normalized] = {
          alias: current.alias,
          favorite,
        }
      } else {
        delete nextMetadataByPath[normalized]
      }

      return {
        ...prev,
        metadataByPath: nextMetadataByPath,
        customTags: serverTagPaths.has(normalized) ? prev.customTags : normalizeTagList([...prev.customTags, normalized]),
      }
    })
  }

  const toggleFavorite = (tagPath: string) => {
    const normalized = normalizeTagPath(tagPath)
    if (!normalized) {
      return
    }

    const currentFavorite = preferences.metadataByPath[normalized]?.favorite ?? false
    setFavorite(normalized, !currentFavorite)
  }

  const setAlias = (tagPath: string, aliasValue: string): { ok: boolean; error?: string } => {
    const normalized = normalizeTagPath(tagPath)
    if (!normalized) {
      return { ok: false, error: '별칭을 설정할 태그가 올바르지 않습니다.' }
    }

    const alias = normalizeAliasInput(aliasValue)
    if (alias) {
      const duplicate = Object.entries(preferences.metadataByPath).find(([existingPath, meta]) => {
        if (existingPath === normalized || !meta.alias) {
          return false
        }
        return normalizeAliasKey(meta.alias) === normalizeAliasKey(alias)
      })

      if (duplicate) {
        return { ok: false, error: '별칭은 중복될 수 없습니다.' }
      }
    }

    updatePreferences((prev) => {
      const current = prev.metadataByPath[normalized] ?? { alias: null, favorite: false }
      const nextMetadataByPath = { ...prev.metadataByPath }

      if (alias || current.favorite) {
        nextMetadataByPath[normalized] = {
          alias,
          favorite: current.favorite,
        }
      } else {
        delete nextMetadataByPath[normalized]
      }

      return {
        ...prev,
        metadataByPath: nextMetadataByPath,
        customTags: serverTagPaths.has(normalized) ? prev.customTags : normalizeTagList([...prev.customTags, normalized]),
      }
    })

    return { ok: true }
  }

  const removeLocalTag = (tagPath: string) => {
    const normalized = normalizeTagPath(tagPath)
    if (!normalized || serverTagPaths.has(normalized)) {
      return
    }

    updatePreferences((prev) => {
      const nextMetadataByPath = Object.entries(prev.metadataByPath).reduce<Record<string, TagPreferenceMeta>>((acc, [path, meta]) => {
        if (path !== normalized) {
          acc[path] = meta
        }
        return acc
      }, {})

      const nextOrderByParent = Object.entries(prev.orderByParent).reduce<Record<string, string[]>>((acc, [parentPath, order]) => {
        if (parentPath === getTagOrderKey(normalized)) {
          return acc
        }

        const filteredOrder = order.filter((path) => path !== normalized)
        if (filteredOrder.length > 0) {
          acc[parentPath] = filteredOrder
        }
        return acc
      }, {})

      return {
        ...prev,
        metadataByPath: nextMetadataByPath,
        customTags: prev.customTags.filter((path) => path !== normalized),
        orderByParent: nextOrderByParent,
      }
    })
  }

  const setSiblingOrder = (parentPath: string, orderedChildPaths: string[]) => {
    const normalizedParentPath = normalizeTagPath(parentPath) ?? ''
    const normalizedOrder = normalizeTagList(orderedChildPaths)

    updatePreferences((prev) => {
      const nextOrderByParent = { ...prev.orderByParent }
      const key = getTagOrderKey(normalizedParentPath)

      if (normalizedOrder.length > 0) {
        nextOrderByParent[key] = normalizedOrder
      } else {
        delete nextOrderByParent[key]
      }

      return {
        ...prev,
        orderByParent: nextOrderByParent,
      }
    })
  }

  const favoriteTags = useMemo(
    () =>
      sortTagsByDisplayOrder(
        Object.entries(preferences.metadataByPath)
          .filter(([path, meta]) => meta.favorite && nodeMap.has(path))
          .map(([path]) => path),
        orderIndex,
      ),
    [nodeMap, orderIndex, preferences.metadataByPath],
  )

  return {
    nodes,
    metadataByPath: preferences.metadataByPath,
    favoriteTags,
    serverTagPaths,
    registerTagPath,
    registerTagPaths,
    toggleFavorite,
    setFavorite,
    setAlias,
    removeLocalTag,
    setSiblingOrder,
    sortTags: (tagPaths) => sortTagsByDisplayOrder(tagPaths, orderIndex),
    getChipLabel: (tagPath) => preferences.metadataByPath[tagPath]?.alias ?? tagPath,
    getTreeLabel: (tagPath, fallbackName) => preferences.metadataByPath[tagPath]?.alias ?? fallbackName,
    getAlias: (tagPath) => preferences.metadataByPath[tagPath]?.alias ?? null,
    resolveExactAlias: (value) => {
      const alias = normalizeAliasInput(value)
      if (!alias) {
        return null
      }

      const matchedEntry = Object.entries(preferences.metadataByPath).find(([, meta]) => {
        if (!meta.alias) {
          return false
        }
        return normalizeAliasKey(meta.alias) === normalizeAliasKey(alias)
      })

      return matchedEntry?.[0] ?? null
    },
    isLocalOnlyLeafTag: (tagPath) => {
      const normalized = normalizeTagPath(tagPath)
      if (!normalized || serverTagPaths.has(normalized)) {
        return false
      }
      return (nodeMap.get(normalized)?.children.length ?? 0) === 0
    },
  }
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

function loadWordListStudyMaskMode(): StudyMaskMode {
  if (typeof window === 'undefined') {
    return 'off'
  }

  try {
    const raw = window.localStorage.getItem(WORD_LIST_STUDY_MASK_MODE_STORAGE_KEY)
    if (raw === 'hideWord' || raw === 'hideMeaning' || raw === 'off') {
      return raw
    }
    return 'off'
  } catch {
    return 'off'
  }
}

function saveWordListStudyMaskMode(mode: StudyMaskMode): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(WORD_LIST_STUDY_MASK_MODE_STORAGE_KEY, mode)
  } catch {
    // localStorage 접근 실패시 목록 암기 모드 저장을 생략한다.
  }
}

function loadWordListRandomOrder(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(WORD_LIST_RANDOM_ORDER_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function saveWordListRandomOrder(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(WORD_LIST_RANDOM_ORDER_STORAGE_KEY, String(enabled))
  } catch {
    // localStorage 접근 실패시 목록 랜덤 정렬 저장을 생략한다.
  }
}

function loadWordListViewState(): WordListViewState {
  if (typeof window === 'undefined') {
    return DEFAULT_WORD_LIST_VIEW_STATE
  }

  try {
    const legacyFavoritesOnly = loadLegacyFavoritesOnly()
    const raw = window.localStorage.getItem(WORD_LIST_VIEW_STATE_STORAGE_KEY)
    if (!raw) {
      return {
        ...DEFAULT_WORD_LIST_VIEW_STATE,
        showFavoritesOnly: legacyFavoritesOnly,
      }
    }

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return {
        ...DEFAULT_WORD_LIST_VIEW_STATE,
        showFavoritesOnly: legacyFavoritesOnly,
      }
    }

    const value = parsed as Partial<WordListViewState>
    return {
      keywordInput: typeof value.keywordInput === 'string' ? value.keywordInput : DEFAULT_WORD_LIST_VIEW_STATE.keywordInput,
      tagInput: typeof value.tagInput === 'string' ? value.tagInput : DEFAULT_WORD_LIST_VIEW_STATE.tagInput,
      groupByDate: typeof value.groupByDate === 'boolean' ? value.groupByDate : DEFAULT_WORD_LIST_VIEW_STATE.groupByDate,
      showFavoritesOnly:
        typeof value.showFavoritesOnly === 'boolean' ? value.showFavoritesOnly : legacyFavoritesOnly,
      favoriteFirst: typeof value.favoriteFirst === 'boolean' ? value.favoriteFirst : DEFAULT_WORD_LIST_VIEW_STATE.favoriteFirst,
      showCardTags: typeof value.showCardTags === 'boolean' ? value.showCardTags : DEFAULT_WORD_LIST_VIEW_STATE.showCardTags,
      showCardExamples:
        typeof value.showCardExamples === 'boolean' ? value.showCardExamples : DEFAULT_WORD_LIST_VIEW_STATE.showCardExamples,
      showCardActions:
        typeof value.showCardActions === 'boolean' ? value.showCardActions : DEFAULT_WORD_LIST_VIEW_STATE.showCardActions,
      showStudyScoreSummary:
        typeof value.showStudyScoreSummary === 'boolean'
          ? value.showStudyScoreSummary
          : DEFAULT_WORD_LIST_VIEW_STATE.showStudyScoreSummary,
      showStudyScoreButtons:
        typeof value.showStudyScoreButtons === 'boolean'
          ? value.showStudyScoreButtons
          : DEFAULT_WORD_LIST_VIEW_STATE.showStudyScoreButtons,
    }
  } catch {
    return {
      ...DEFAULT_WORD_LIST_VIEW_STATE,
      showFavoritesOnly: loadLegacyFavoritesOnly(),
    }
  }
}

function saveWordListViewState(state: WordListViewState): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(WORD_LIST_VIEW_STATE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage 접근 실패시 목록 표시/검색 상태 저장을 생략한다.
  }
}

function loadLegacyWordFavoriteIds(): number[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(LEGACY_WORD_LIST_REVIEW_TARGET_IDS_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    const unique = new Set<number>()
    parsed.forEach((item) => {
      if (typeof item !== 'number' || !Number.isInteger(item) || item <= 0) {
        return
      }
      unique.add(item)
    })
    return [...unique]
  } catch {
    return []
  }
}

function clearLegacyWordFavoriteIds(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(LEGACY_WORD_LIST_REVIEW_TARGET_IDS_STORAGE_KEY)
  } catch {
    // localStorage 접근 실패시 기존 즐겨찾기 키 제거를 생략한다.
  }
}

function loadLegacyFavoritesOnly(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(LEGACY_WORD_LIST_REVIEW_ONLY_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function clearLegacyFavoritesOnly(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(LEGACY_WORD_LIST_REVIEW_ONLY_STORAGE_KEY)
  } catch {
    // localStorage 접근 실패시 기존 즐겨찾기 필터 키 제거를 생략한다.
  }
}

function loadWordFavoriteMigrationDone(): boolean {
  if (typeof window === 'undefined') {
    return true
  }

  try {
    return window.localStorage.getItem(WORD_LIST_FAVORITE_MIGRATION_DONE_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function saveWordFavoriteMigrationDone(done: boolean): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(WORD_LIST_FAVORITE_MIGRATION_DONE_STORAGE_KEY, String(done))
  } catch {
    // localStorage 접근 실패시 즐겨찾기 마이그레이션 상태 저장을 생략한다.
  }
}

function buildNaverDictionaryUrl(word: string): string {
  return `https://en.dict.naver.com/#/search?range=all&query=${encodeURIComponent(normalizeWordInput(word.trim()))}`
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function shuffleItems<T>(items: T[]): T[] {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function shouldSkipCardRevealToggle(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  return Boolean(target.closest('button, input, textarea, select, option, a, label'))
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

function TagManagementModal({
  open,
  nodes,
  metadataByPath,
  onClose,
  onRegisterTagPath,
  onSetFavorite,
  onSetAlias,
  onRemoveLocalTag,
  onSetSiblingOrder,
  getTreeLabel,
  getAlias,
  isLocalOnlyLeafTag,
}: TagManagementModalProps) {
  const flattenedNodes = useMemo(() => flattenTagTree(nodes), [nodes])
  const childPathsByParent = useMemo(() => {
    const mapping = new Map<string, string[]>()
    const visit = (parentPath: string, childNodes: TagTreeNode[]) => {
      mapping.set(parentPath, childNodes.map((child) => child.path))
      childNodes.forEach((child) => visit(child.path, child.children))
    }

    visit('', nodes)
    return mapping
  }, [nodes])

  const [searchInput, setSearchInput] = useState('')
  const [newTagInput, setNewTagInput] = useState('')
  const [newTagError, setNewTagError] = useState<string | null>(null)
  const [selectedTagPath, setSelectedTagPath] = useState<string | null>(null)
  const [aliasInput, setAliasInput] = useState('')
  const [aliasError, setAliasError] = useState<string | null>(null)
  const [manualExpandedPaths, setManualExpandedPaths] = useState<Set<string>>(() => new Set())
  const [dragState, setDragState] = useState<{ path: string; parentPath: string } | null>(null)
  const [dropState, setDropState] = useState<{ targetPath: string; parentPath: string; position: TagDropPosition } | null>(null)

  const { nodes: filteredNodes, autoExpandedPaths } = useMemo(
    () => filterTagTreeByQuery(nodes, searchInput, metadataByPath),
    [metadataByPath, nodes, searchInput],
  )
  const effectiveExpandedPaths = useMemo(
    () => new Set<string>([...manualExpandedPaths, ...autoExpandedPaths]),
    [autoExpandedPaths, manualExpandedPaths],
  )

  useEffect(() => {
    if (!open) {
      return
    }

    setSearchInput('')
    setNewTagInput('')
    setNewTagError(null)
    setAliasError(null)
    setManualExpandedPaths(new Set())
    setDragState(null)
    setDropState(null)
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    const firstTagPath = flattenedNodes[0]?.path ?? null
    setSelectedTagPath((prev) => {
      if (prev && flattenedNodes.some((node) => node.path === prev)) {
        return prev
      }
      return firstTagPath
    })
  }, [flattenedNodes, open])

  useEffect(() => {
    if (!selectedTagPath) {
      setAliasInput('')
      setAliasError(null)
      return
    }

    setAliasInput(metadataByPath[selectedTagPath]?.alias ?? '')
    setAliasError(null)
  }, [metadataByPath, selectedTagPath])

  const expandAncestors = (tagPath: string) => {
    setManualExpandedPaths((prev) => {
      const next = new Set(prev)
      let currentParent = getTagParentPath(tagPath)
      while (currentParent.length > 0) {
        next.add(currentParent)
        currentParent = getTagParentPath(currentParent)
      }
      return next
    })
  }

  const toggleExpanded = (tagPath: string) => {
    setManualExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(tagPath)) {
        next.delete(tagPath)
      } else {
        next.add(tagPath)
      }
      return next
    })
  }

  const addManagedTag = () => {
    const normalized = normalizeTagPath(newTagInput)
    if (!normalized) {
      setNewTagError('태그 경로를 입력해 주세요.')
      return
    }
    if (normalized.length > MAX_TAG_LEN) {
      setNewTagError(`태그는 ${MAX_TAG_LEN}자 이하로 입력해 주세요.`)
      return
    }

    onRegisterTagPath(normalized)
    expandAncestors(normalized)
    setSelectedTagPath(normalized)
    setNewTagInput('')
    setNewTagError(null)
  }

  const saveAlias = () => {
    if (!selectedTagPath) {
      return
    }

    const result = onSetAlias(selectedTagPath, aliasInput)
    if (!result.ok) {
      setAliasError(result.error ?? '별칭 저장에 실패했습니다.')
      return
    }

    setAliasError(null)
  }

  const renderNode = (node: TagTreeNode): JSX.Element => {
    const hasChildren = node.children.length > 0
    const isExpanded = effectiveExpandedPaths.has(node.path)
    const isSelected = selectedTagPath === node.path
    const isFavorite = Boolean(metadataByPath[node.path]?.favorite)
    const currentAlias = metadataByPath[node.path]?.alias
    const parentPath = getTagParentPath(node.path)
    const dropLabel =
      dropState?.targetPath === node.path && dropState.parentPath === parentPath
        ? dropState.position === 'before'
          ? '앞에 놓기'
          : '뒤에 놓기'
        : null

    return (
      <div key={`tag-manage-${node.path}`} className="space-y-1">
        <div
          draggable
          className={`rounded-xl border px-2 py-2 transition ${
            isSelected ? 'border-sky-400 bg-sky-50' : 'border-sky-100 bg-white hover:border-sky-200 hover:bg-sky-50/40'
          } ${dropLabel ? 'ring-2 ring-sky-200' : ''}`}
          onDragStart={(event) => {
            const nextParentPath = getTagParentPath(node.path)
            setDragState({ path: node.path, parentPath: nextParentPath })
            setDropState(null)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', node.path)
          }}
          onDragOver={(event) => {
            if (!dragState || dragState.path === node.path || dragState.parentPath !== parentPath) {
              return
            }

            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            const position: TagDropPosition = event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before'
            setDropState({
              targetPath: node.path,
              parentPath,
              position,
            })
          }}
          onDrop={(event) => {
            event.preventDefault()
            if (!dragState || dragState.path === node.path || dragState.parentPath !== parentPath) {
              setDragState(null)
              setDropState(null)
              return
            }

            const currentSiblingPaths = childPathsByParent.get(parentPath) ?? []
            const position = dropState?.targetPath === node.path ? dropState.position : 'before'
            const nextOrder = reorderSiblingPaths(currentSiblingPaths, dragState.path, node.path, position)
            onSetSiblingOrder(parentPath, nextOrder)
            setDragState(null)
            setDropState(null)
          }}
          onDragEnd={() => {
            setDragState(null)
            setDropState(null)
          }}
          title="같은 부모 아래에서 드래그해 순서를 변경합니다."
        >
          <div className="flex items-center gap-2" style={{ paddingLeft: `${8 + node.depth * 14}px` }}>
            <span className="w-4 text-center text-stone-400">≡</span>
            {hasChildren ? (
              <button
                type="button"
                className="w-5 text-center text-sm text-sky-700"
                onClick={() => toggleExpanded(node.path)}
                title={isExpanded ? '접기' : '펼치기'}
              >
                {isExpanded ? '▾' : '▸'}
              </button>
            ) : (
              <span className="w-5 text-center text-stone-300">•</span>
            )}
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedTagPath(node.path)}>
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-stone-900">{getTreeLabel(node.path, node.name)}</span>
                {isFavorite && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">★</span>}
                {dropLabel && <span className="text-[11px] font-semibold text-sky-700">{dropLabel}</span>}
              </div>
              {currentAlias && <p className="truncate text-[11px] text-stone-500">#{node.path}</p>}
            </button>
          </div>
        </div>

        {hasChildren && isExpanded && <div className="space-y-1">{node.children.map((child) => renderNode(child))}</div>}
      </div>
    )
  }

  if (!open) {
    return null
  }

  const selectedMeta = selectedTagPath ? metadataByPath[selectedTagPath] ?? { alias: null, favorite: false } : null

  const modalContent = (
    <div
      className="fixed inset-0 z-[95] bg-stone-900/25 px-4 py-6"
      onMouseDown={(event) => {
        event.stopPropagation()
        onClose()
      }}
    >
      <div
        className="mx-auto flex max-h-[calc(100vh-48px)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-sky-100 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-stone-900">태그 관리</h3>
            <p className="text-xs text-stone-500">즐겨찾기, 별칭, 전역 표시 순서를 로컬에 저장합니다.</p>
          </div>
          <button
            type="button"
            className="rounded-md border border-sky-200 px-2 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-50"
            onClick={onClose}
          >
            닫기
          </button>
        </div>

        <div className="grid flex-1 gap-4 overflow-hidden px-5 py-4 lg:grid-cols-[minmax(0,1.15fr)_340px]">
          <section className="flex min-h-0 flex-col rounded-2xl border border-sky-100">
            <div className="space-y-3 border-b border-sky-100 px-4 py-4">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="태그/별칭 검색"
                  className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
                <button
                  type="button"
                  className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-50"
                  onClick={() => setSearchInput('')}
                >
                  검색 초기화
                </button>
              </div>

              <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3">
                <p className="text-xs font-semibold text-sky-800">로컬 태그 등록</p>
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
                    onClick={addManagedTag}
                  >
                    등록
                  </button>
                </div>
                {newTagError && <p className="mt-1 text-xs font-semibold text-rose-600">{newTagError}</p>}
              </div>

              <p className="text-[11px] text-stone-500">드래그앤드롭은 같은 부모 아래 형제 태그끼리만 가능합니다.</p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {flattenedNodes.length === 0 && <p className="px-2 py-1 text-xs text-stone-500">표시할 태그가 없습니다.</p>}
              {flattenedNodes.length > 0 && filteredNodes.length === 0 && <p className="px-2 py-1 text-xs text-stone-500">검색 결과가 없습니다.</p>}
              {filteredNodes.length > 0 && <div className="space-y-1">{filteredNodes.map((node) => renderNode(node))}</div>}
            </div>
          </section>

          <section className="flex min-h-0 flex-col rounded-2xl border border-sky-100 bg-sky-50/50">
            <div className="border-b border-sky-100 px-4 py-4">
              <h4 className="text-sm font-bold text-stone-900">태그 상세</h4>
              <p className="mt-1 text-xs text-stone-500">별칭은 중복될 수 없고, 즐겨찾기 태그는 선택 모달 상단에 노출됩니다.</p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {!selectedTagPath && <p className="text-sm text-stone-500">관리할 태그를 선택해 주세요.</p>}

              {selectedTagPath && selectedMeta && (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-stone-500">태그 경로</p>
                    <p className="mt-1 break-all rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm font-semibold text-stone-900">
                      #{selectedTagPath}
                    </p>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm text-stone-900">
                    <input
                      type="checkbox"
                      checked={selectedMeta.favorite}
                      onChange={(event) => onSetFavorite(selectedTagPath, event.target.checked)}
                      className="h-4 w-4 rounded border-sky-300 text-sky-700 focus:ring-sky-400"
                    />
                    즐겨찾기 태그로 표시
                  </label>

                  <form
                    className="space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      saveAlias()
                    }}
                  >
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-stone-500">별칭</span>
                      <input
                        value={aliasInput}
                        onChange={(event) => {
                          setAliasInput(event.target.value)
                          if (aliasError) {
                            setAliasError(null)
                          }
                        }}
                        placeholder="짧은 표시 이름"
                        className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                      />
                    </label>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-800"
                      >
                        별칭 저장
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-50"
                        onClick={() => {
                          setAliasInput('')
                          const result = onSetAlias(selectedTagPath, '')
                          if (!result.ok) {
                            setAliasError(result.error ?? '별칭 초기화에 실패했습니다.')
                            return
                          }
                          setAliasError(null)
                        }}
                      >
                        별칭 지우기
                      </button>
                    </div>
                    {aliasError && <p className="text-xs font-semibold text-rose-600">{aliasError}</p>}
                  </form>

                  <div className="rounded-xl border border-sky-100 bg-white px-3 py-3">
                    <p className="text-xs font-semibold text-stone-500">현재 표시</p>
                    <p className="mt-1 text-sm font-semibold text-stone-900">{getTreeLabel(selectedTagPath, getTagLeafName(selectedTagPath))}</p>
                    {getAlias(selectedTagPath) && <p className="mt-1 text-xs text-stone-500">전체 경로: #{selectedTagPath}</p>}
                  </div>

                  {isLocalOnlyLeafTag(selectedTagPath) && (
                    <button
                      type="button"
                      className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                      onClick={() => {
                        onRemoveLocalTag(selectedTagPath)
                      }}
                    >
                      로컬 태그 제거
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}

function TagPickerModal({ open, title, selectedTags, loading, anchorEl, tagPreferences, onClose, onApply }: TagPickerModalProps) {
  const { nodes, metadataByPath, favoriteTags, serverTagPaths } = tagPreferences
  const flattenedNodes = useMemo(() => flattenTagTree(nodes), [nodes])
  const knownTagPathSet = useMemo(() => new Set(flattenedNodes.map((node) => node.path)), [flattenedNodes])
  const orderIndex = useMemo(() => buildTagOrderIndex(nodes), [nodes])
  const orderedSelectedTags = useMemo(
    () => sortTagsByDisplayOrder(collapseHierarchicalTags(selectedTags), orderIndex),
    [orderIndex, selectedTags],
  )

  const [localSelected, setLocalSelected] = useState<string[]>(() => orderedSelectedTags)
  const [searchInput, setSearchInput] = useState('')
  const [newTagInput, setNewTagInput] = useState('')
  const [newTagError, setNewTagError] = useState<string | null>(null)
  const [viewportTick, setViewportTick] = useState(0)
  const [manualExpandedPaths, setManualExpandedPaths] = useState<Set<string>>(() => new Set())
  const [manageModalOpen, setManageModalOpen] = useState(false)

  const { nodes: filteredNodes, autoExpandedPaths } = useMemo(
    () => filterTagTreeByQuery(nodes, searchInput, metadataByPath),
    [metadataByPath, nodes, searchInput],
  )
  const effectiveExpandedPaths = useMemo(
    () => new Set<string>([...manualExpandedPaths, ...autoExpandedPaths]),
    [autoExpandedPaths, manualExpandedPaths],
  )

  useEffect(() => {
    if (!open) {
      return
    }

    setLocalSelected(orderedSelectedTags)
    setSearchInput('')
    setNewTagInput('')
    setNewTagError(null)
    setManualExpandedPaths(new Set())
  }, [open, orderedSelectedTags])

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
  const panelWidth = Math.min(780, viewportWidth - viewportGutter * 2)
  const estimatedPanelHeight = Math.min(700, viewportHeight - viewportGutter * 2)
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

  const selectedSet = new Set(localSelected)
  const customSelected = localSelected.filter((tag) => !knownTagPathSet.has(tag) && !serverTagPaths.has(tag))

  const sortSelectedTags = (tags: string[]) => sortTagsByDisplayOrder(tags, orderIndex)

  const toggleExpanded = (tagPath: string) => {
    setManualExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(tagPath)) {
        next.delete(tagPath)
      } else {
        next.add(tagPath)
      }
      return next
    })
  }

  const toggleTag = (tagPath: string) => {
    const normalized = normalizeTagPath(tagPath)
    if (!normalized) {
      return
    }

    setLocalSelected((prev) => {
      if (prev.includes(normalized)) {
        return sortSelectedTags(prev.filter((tag) => tag !== normalized))
      }
      const withoutBranch = prev.filter((tag) => !isSameTagBranch(tag, normalized))
      return sortSelectedTags(collapseHierarchicalTags([...withoutBranch, normalized]))
    })
  }

  const removeSelectedTag = (tagPath: string) => {
    setLocalSelected((prev) => sortSelectedTags(prev.filter((tag) => tag !== tagPath)))
  }

  const expandAncestors = (tagPath: string) => {
    setManualExpandedPaths((prev) => {
      const next = new Set(prev)
      let currentParent = getTagParentPath(tagPath)
      while (currentParent.length > 0) {
        next.add(currentParent)
        currentParent = getTagParentPath(currentParent)
      }
      return next
    })
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

    tagPreferences.registerTagPath(normalized)
    expandAncestors(normalized)
    setLocalSelected((prev) => {
      const withoutBranch = prev.filter((tag) => !isSameTagBranch(tag, normalized))
      return sortSelectedTags(collapseHierarchicalTags([...withoutBranch, normalized]))
    })
    setNewTagInput('')
    setNewTagError(null)
  }

  const renderNode = (node: TagTreeNode): JSX.Element => {
    const hasChildren = node.children.length > 0
    const isExpanded = effectiveExpandedPaths.has(node.path)
    const alias = metadataByPath[node.path]?.alias
    const isFavorite = Boolean(metadataByPath[node.path]?.favorite)

    return (
      <div key={`tag-picker-node-${node.path}`} className="space-y-1">
        <div className="rounded-xl border border-sky-100 bg-white px-2 py-1.5 transition hover:border-sky-200 hover:bg-sky-50/60">
          <div className="flex items-center gap-2" style={{ paddingLeft: `${6 + node.depth * 14}px` }}>
            {hasChildren ? (
              <button
                type="button"
                className="w-5 text-center text-sm text-sky-700"
                onClick={() => toggleExpanded(node.path)}
                title={isExpanded ? '접기' : '펼치기'}
              >
                {isExpanded ? '▾' : '▸'}
              </button>
            ) : (
              <span className="w-5 text-center text-stone-300">•</span>
            )}
            <input
              type="checkbox"
              checked={selectedSet.has(node.path)}
              onChange={() => toggleTag(node.path)}
              className="h-4 w-4 rounded border-sky-300 text-sky-700 focus:ring-sky-400"
            />
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                if (hasChildren) {
                  toggleExpanded(node.path)
                } else {
                  toggleTag(node.path)
                }
              }}
              title={`#${node.path}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-stone-900">
                  {getTagTreeLabel(node.path, node.name, metadataByPath)}
                </span>
                {isFavorite && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">★</span>}
              </div>
              {alias && <p className="truncate text-[11px] text-stone-500">#{node.path}</p>}
            </button>
          </div>
        </div>

        {hasChildren && isExpanded && <div className="space-y-1">{node.children.map((child) => renderNode(child))}</div>}
      </div>
    )
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
          <div>
            <h3 className="text-base font-bold text-stone-900">{title}</h3>
            <p className="text-xs text-stone-500">즐겨찾기와 별칭은 태그 관리에서 조정할 수 있습니다.</p>
          </div>
          <button
            type="button"
            className="rounded-md border border-sky-200 px-2 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-50"
            onClick={onClose}
          >
            닫기
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4" style={{ maxHeight: 'calc(100vh - 128px)' }}>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="태그/별칭 검색 (예: 시험/토익)"
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
            <button
              type="button"
              className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-50"
              onClick={() => setManageModalOpen(true)}
            >
              태그 관리
            </button>
          </div>

          <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-amber-800">즐겨찾기 빠른 선택</p>
              <span className="text-[11px] text-amber-700">클릭하면 바로 추가/제거됩니다.</span>
            </div>
            {favoriteTags.length === 0 && <p className="mt-2 text-xs text-stone-500">즐겨찾기 태그가 없습니다. 태그 관리에서 추가해 주세요.</p>}
            {favoriteTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {favoriteTags.map((tagPath) => {
                  const isSelected = selectedSet.has(tagPath)
                  return (
                    <button
                      key={`favorite-tag-${tagPath}`}
                      type="button"
                      className={`max-w-full rounded-full px-3 py-1 text-xs font-semibold transition ${
                        isSelected ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-white text-amber-800 hover:bg-amber-100'
                      }`}
                      onClick={() => toggleTag(tagPath)}
                      title={`#${tagPath}`}
                    >
                      <span className="truncate">{getTagChipLabel(tagPath, metadataByPath)}</span>
                    </button>
                  )
                })}
              </div>
            )}
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
              <div className="max-h-72 space-y-1 overflow-y-auto px-2 py-2">
                {loading && <p className="px-2 py-1 text-xs text-stone-500">태그 불러오는 중...</p>}
                {!loading && flattenedNodes.length === 0 && <p className="px-2 py-1 text-xs text-stone-500">표시할 태그가 없습니다.</p>}
                {!loading && flattenedNodes.length > 0 && filteredNodes.length === 0 && (
                  <p className="px-2 py-1 text-xs text-stone-500">검색 결과가 없습니다.</p>
                )}
                {!loading && filteredNodes.length > 0 && <div className="space-y-1">{filteredNodes.map((node) => renderNode(node))}</div>}
              </div>
            </div>

            <div className="rounded-xl border border-sky-100">
              <p className="border-b border-sky-100 px-3 py-2 text-xs font-semibold text-stone-600">선택된 태그 ({localSelected.length})</p>
              <div className="max-h-72 overflow-y-auto px-3 py-2">
                {localSelected.length === 0 && <p className="text-xs text-stone-500">선택된 태그가 없습니다.</p>}
                {localSelected.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {localSelected.map((tagPath) => (
                      <button
                        key={`selected-tag-${tagPath}`}
                        type="button"
                        className={`max-w-full rounded-full px-2 py-1 text-xs font-semibold ${
                          customSelected.includes(tagPath) ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'
                        }`}
                        onClick={() => removeSelectedTag(tagPath)}
                        title={`클릭해서 제거 · #${tagPath}`}
                      >
                        <span className="truncate">{getTagChipLabel(tagPath, metadataByPath)}</span>
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
              onApply(sortSelectedTags(collapseHierarchicalTags(localSelected)))
              onClose()
            }}
          >
            적용
          </button>
        </div>
      </div>

      <TagManagementModal
        open={manageModalOpen}
        nodes={nodes}
        metadataByPath={metadataByPath}
        serverTagPaths={serverTagPaths}
        onClose={() => setManageModalOpen(false)}
        onRegisterTagPath={tagPreferences.registerTagPath}
        onSetFavorite={tagPreferences.setFavorite}
        onSetAlias={tagPreferences.setAlias}
        onRemoveLocalTag={tagPreferences.removeLocalTag}
        onSetSiblingOrder={tagPreferences.setSiblingOrder}
        getChipLabel={tagPreferences.getChipLabel}
        getTreeLabel={tagPreferences.getTreeLabel}
        getAlias={tagPreferences.getAlias}
        isLocalOnlyLeafTag={tagPreferences.isLocalOnlyLeafTag}
      />
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}

interface FavoriteTagQuickBarProps {
  favoriteTags: string[]
  selectedTags: string[]
  metadataByPath: Record<string, TagPreferenceMeta>
  disabled?: boolean
  onToggleTag: (tagPath: string) => void
  className?: string
}

function FavoriteTagQuickBar({
  favoriteTags,
  selectedTags,
  metadataByPath,
  disabled = false,
  onToggleTag,
  className = 'flex shrink-0 items-center gap-2',
}: FavoriteTagQuickBarProps) {
  const visibleFavoriteTags = favoriteTags.filter((tagPath) => tagPath !== PRONUNCIATION_TAG)

  if (visibleFavoriteTags.length === 0) {
    return null
  }

  const selectedTagSet = new Set(selectedTags)

  return (
    <div className={className}>
      {visibleFavoriteTags.map((tagPath) => {
        const isSelected = selectedTagSet.has(tagPath)
        return (
          <button
            key={`favorite-quick-toggle-${tagPath}`}
            type="button"
            className={`shrink-0 whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-semibold transition ${
              isSelected
                ? 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200'
                : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
            } disabled:cursor-not-allowed disabled:opacity-50`}
            onClick={() => onToggleTag(tagPath)}
            title={`#${tagPath}`}
            disabled={disabled}
          >
            <span className="truncate">{getTagChipLabel(tagPath, metadataByPath)}</span>
          </button>
        )
      })}
    </div>
  )
}

interface NaverDictionaryLinkProps {
  word: string
  className?: string
  iconClassName?: string
  title?: string
}

function NaverDictionaryLink({
  word,
  className = 'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-200 bg-white transition hover:bg-emerald-50',
  iconClassName = 'h-4 w-4 rounded-[4px]',
  title = '네이버 사전 열기',
}: NaverDictionaryLinkProps) {
  const normalizedWord = normalizeWordInput(word.trim())

  if (normalizedWord.length === 0) {
    return null
  }

  return (
    <a
      href={buildNaverDictionaryUrl(normalizedWord)}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
      title={title}
      aria-label={`${normalizedWord} 네이버 사전 열기`}
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      <img src={NAVER_DICTIONARY_ICON_URL} alt="" className={iconClassName} />
    </a>
  )
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
  const tagPreferences = useTagPreferences(tagTree)
  const tagOrderIndex = useMemo(() => buildTagOrderIndex(tagPreferences.nodes), [tagPreferences.nodes])

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const meaningInputRef = useRef<HTMLTextAreaElement | null>(null)
  const debouncedWord = useDebouncedValue(form.word, 240)

  const wordError = getFieldError(fieldErrors, 'word')
  const meaningError = getFieldError(fieldErrors, 'meaningKo')
  const memoError = getFieldError(fieldErrors, 'memo')
  const tagsError = getFieldError(fieldErrors, 'tags')
  const examplesError = getFieldError(fieldErrors, 'examples')

  const shouldShowSuggest = !isEditing && wordFocused && (suggestLoading || suggestions.length > 0)
  const selectedFormTags = useMemo(
    () => sortTagsByDisplayOrder(collapseHierarchicalTags(parseTags(form.tagsText)), tagOrderIndex),
    [form.tagsText, tagOrderIndex],
  )
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
    const nextTags = sortTagsByDisplayOrder(toggleTagPath(parseTags(form.tagsText), PRONUNCIATION_TAG), tagOrderIndex)
    updateField('tagsText', nextTags.join(', '))
    rememberRecentTags(nextTags)
  }

  const toggleFormFavoriteTag = (tagPath: string) => {
    const nextTags = sortTagsByDisplayOrder(toggleTagPath(parseTags(form.tagsText), tagPath), tagOrderIndex)
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
    const tags = sortTagsByDisplayOrder(collapseHierarchicalTags(parseTags(form.tagsText)), tagOrderIndex)
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
            <div className="flex items-center gap-2">
              <NaverDictionaryLink
                word={form.word}
                title="네이버 영어사전 열기"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-200 bg-white transition hover:bg-emerald-50"
              />
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
                <div className="flex items-center gap-3 overflow-x-auto pb-1">
                  <p className="shrink-0 whitespace-nowrap text-xs font-semibold text-sky-800">태그 선택 모달</p>
                  <div className="flex shrink-0 items-center gap-2">
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
                    <FavoriteTagQuickBar
                      favoriteTags={tagPreferences.favoriteTags}
                      selectedTags={selectedFormTags}
                      metadataByPath={tagPreferences.metadataByPath}
                      disabled={saving || loadingItem}
                      onToggleTag={toggleFormFavoriteTag}
                    />
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
                    <button
                      key={`form-selected-${tagPath}`}
                      type="button"
                      className="max-w-full rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800"
                      onClick={() => {
                        const nextTags = selectedFormTags.filter((tag) => tag !== tagPath)
                        updateField('tagsText', nextTags.join(', '))
                      }}
                      title={`클릭해서 제거 · #${tagPath}`}
                    >
                      <span className="truncate">{getTagChipLabel(tagPath, tagPreferences.metadataByPath)}</span>
                    </button>
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
        selectedTags={selectedFormTags}
        loading={tagTreeLoading}
        anchorEl={tagModalAnchor}
        tagPreferences={tagPreferences}
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
  const tagPreferences = useTagPreferences(tagTree)
  const tagOrderIndex = useMemo(() => buildTagOrderIndex(tagPreferences.nodes), [tagPreferences.nodes])
  const [bulkCaretContext, setBulkCaretContext] = useState<BulkCaretContext | null>(null)
  const [bulkSuggestQuery, setBulkSuggestQuery] = useState('')
  const [bulkSuggestLoading, setBulkSuggestLoading] = useState(false)
  const [bulkSuggestions, setBulkSuggestions] = useState<SuggestItem[]>([])
  const [bulkSuggestAnchor, setBulkSuggestAnchor] = useState<{ top: number; left: number } | null>(null)
  const [prefetchedApiMeanings, setPrefetchedApiMeanings] = useState<Record<string, string | null>>({})
  const prefetchedLoadingWordsRef = useRef<Set<string>>(new Set())

  const parsed = useMemo(() => parseBulkInput(inputText), [inputText])
  const selectedTags = useMemo(
    () => sortTagsByDisplayOrder(collapseHierarchicalTags(parseTags(tagsText)), tagOrderIndex),
    [tagOrderIndex, tagsText],
  )
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
    const nextTags = sortTagsByDisplayOrder(toggleTagPath(parseTags(tagsText), PRONUNCIATION_TAG), tagOrderIndex)
    setTagsText(nextTags.join(', '))
    rememberRecentTags(nextTags)
  }

  const toggleBulkFavoriteTag = (tagPath: string) => {
    const nextTags = sortTagsByDisplayOrder(toggleTagPath(parseTags(tagsText), tagPath), tagOrderIndex)
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

    const tags = sortTagsByDisplayOrder(collapseHierarchicalTags(parseTags(tagsText)), tagOrderIndex)
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
            <div className="flex items-center gap-3 overflow-x-auto pb-1">
              <p className="shrink-0 whitespace-nowrap text-xs font-semibold text-sky-800">태그 선택 모달</p>
              <div className="flex shrink-0 items-center gap-2">
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
                <FavoriteTagQuickBar
                  favoriteTags={tagPreferences.favoriteTags}
                  selectedTags={selectedTags}
                  metadataByPath={tagPreferences.metadataByPath}
                  disabled={saving}
                  onToggleTag={toggleBulkFavoriteTag}
                />
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
                <button
                  key={`bulk-selected-${tagPath}`}
                  type="button"
                  className="max-w-full rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800"
                  onClick={() => {
                    const nextTags = selectedTags.filter((tag) => tag !== tagPath)
                    setTagsText(nextTags.join(', '))
                  }}
                  title={`클릭해서 제거 · #${tagPath}`}
                >
                  <span className="truncate">{getTagChipLabel(tagPath, tagPreferences.metadataByPath)}</span>
                </button>
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
        selectedTags={selectedTags}
        loading={tagTreeLoading}
        anchorEl={tagModalAnchor}
        tagPreferences={tagPreferences}
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
  const initialViewState = useMemo(() => loadWordListViewState(), [])

  const [keywordInput, setKeywordInput] = useState(() => initialViewState.keywordInput)
  const [tagInput, setTagInput] = useState(() => initialViewState.tagInput)
  const [groupByDate, setGroupByDate] = useState(() => initialViewState.groupByDate)
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(() => initialViewState.showFavoritesOnly)
  const [favoriteFirst, setFavoriteFirst] = useState(() => initialViewState.favoriteFirst)
  const [favoriteMigrationReady, setFavoriteMigrationReady] = useState(() => loadWordFavoriteMigrationDone())
  const [page, setPage] = useState(0)
  const [pageData, setPageData] = useState<PageResponse<VocaResponse> | null>(null)
  const [listLoading, setListLoading] = useState(() => !loadWordFavoriteMigrationDone())
  const [listRefreshToken, setListRefreshToken] = useState(0)
  const [openExampleIds, setOpenExampleIds] = useState<Record<number, boolean>>({})
  const [expandedMeaningIds, setExpandedMeaningIds] = useState<Record<number, boolean>>({})
  const [expandedMemoIds, setExpandedMemoIds] = useState<Record<number, boolean>>({})
  const [showCardTags, setShowCardTags] = useState(() => initialViewState.showCardTags)
  const [showCardExamples, setShowCardExamples] = useState(() => initialViewState.showCardExamples)
  const [showCardActions, setShowCardActions] = useState(() => initialViewState.showCardActions)
  const [showStudyScoreSummary, setShowStudyScoreSummary] = useState(() => initialViewState.showStudyScoreSummary)
  const [showStudyScoreButtons, setShowStudyScoreButtons] = useState(() => initialViewState.showStudyScoreButtons)
  const [studyMaskMode, setStudyMaskMode] = useState<StudyMaskMode>(() => loadWordListStudyMaskMode())
  const [shuffleCards, setShuffleCards] = useState(() => loadWordListRandomOrder())
  const [activeStudyCardId, setActiveStudyCardId] = useState<number | null>(null)
  const [revealedCardIdsByMode, setRevealedCardIdsByMode] = useState<RevealByMaskMode>({
    hideWord: {},
    hideMeaning: {},
  })
  const [displayOptionsOpen, setDisplayOptionsOpen] = useState(false)
  const [tagTree, setTagTree] = useState<TagTreeNode[]>([])
  const [tagTreeLoading, setTagTreeLoading] = useState(false)
  const [, setRecentTags] = useState<string[]>(() => loadRecentTags())
  const [quickTags, setQuickTags] = useState<string[]>(() => loadRecentTags())
  const [quickTagModalOpen, setQuickTagModalOpen] = useState(false)
  const [quickTagModalAnchor, setQuickTagModalAnchor] = useState<HTMLButtonElement | null>(null)
  const tagPreferences = useTagPreferences(tagTree)
  const tagOrderIndex = useMemo(() => buildTagOrderIndex(tagPreferences.nodes), [tagPreferences.nodes])
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
  const displayedQuickTags = useMemo(
    () => sortTagsByDisplayOrder(collapseHierarchicalTags(quickTags), tagOrderIndex),
    [quickTags, tagOrderIndex],
  )
  const hasQuickPronunciationTag = displayedQuickTags.includes(PRONUNCIATION_TAG)
  const resolvedTagQuery = useMemo(
    () => resolveTagPathByExactAlias(debouncedTag, tagPreferences.metadataByPath) ?? debouncedTag.trim(),
    [debouncedTag, tagPreferences.metadataByPath],
  )
  const listItems = pageData?.items ?? []
  const orderedItems = useMemo(() => {
    if (!shuffleCards) {
      return listItems
    }
    return shuffleItems(listItems)
  }, [listItems, shuffleCards])
  const groupedByDateItems = useMemo(() => {
    const groups: Array<{ key: string; label: string; items: VocaResponse[] }> = []
    const groupMap = new Map<string, { key: string; label: string; items: VocaResponse[] }>()

    listItems.forEach((item) => {
      const key = getLocalDateKey(item.createdAt)
      if (!groupMap.has(key)) {
        const nextGroup = { key, label: formatDateGroupLabel(key), items: [] as VocaResponse[] }
        groupMap.set(key, nextGroup)
        groups.push(nextGroup)
      }
      groupMap.get(key)?.items.push(item)
    })

    if (!shuffleCards) {
      return groups
    }

    return groups.map((group) => ({
      ...group,
      items: shuffleItems(group.items),
    }))
  }, [listItems, shuffleCards])
  const visibleCardIds = useMemo(() => {
    if (!groupByDate) {
      return orderedItems.map((item) => item.id)
    }
    return groupedByDateItems.flatMap((group) => group.items.map((item) => item.id))
  }, [groupByDate, groupedByDateItems, orderedItems])

  const itemCount = pageData?.items.length ?? 0
  const totalElements = pageData?.totalElements ?? 0
  const totalPages = pageData?.totalPages ?? 0

  const pageNumbers = useMemo(() => buildPageNumbers(page, totalPages), [page, totalPages])
  const studyModeLabel = useMemo(() => {
    if (studyMaskMode === 'hideWord') {
      return '단어 가리기'
    }
    if (studyMaskMode === 'hideMeaning') {
      return '뜻 가리기'
    }
    return '끔'
  }, [studyMaskMode])

  useEffect(() => {
    saveWordListStudyMaskMode(studyMaskMode)
  }, [studyMaskMode])

  useEffect(() => {
    saveWordListRandomOrder(shuffleCards)
  }, [shuffleCards])

  useEffect(() => {
    saveWordListViewState({
      keywordInput,
      tagInput,
      groupByDate,
      showFavoritesOnly,
      favoriteFirst,
      showCardTags,
      showCardExamples,
      showCardActions,
      showStudyScoreSummary,
      showStudyScoreButtons,
    })
  }, [
    groupByDate,
    keywordInput,
    favoriteFirst,
    showCardActions,
    showCardExamples,
    showCardTags,
    showFavoritesOnly,
    showStudyScoreButtons,
    showStudyScoreSummary,
    tagInput,
  ])

  useEffect(() => {
    let cancelled = false
    const legacyIds = loadLegacyWordFavoriteIds()

    if (favoriteMigrationReady) {
      return () => {
        cancelled = true
      }
    }

    if (legacyIds.length === 0) {
      saveWordFavoriteMigrationDone(true)
      clearLegacyWordFavoriteIds()
      clearLegacyFavoritesOnly()
      setFavoriteMigrationReady(true)
      return () => {
        cancelled = true
      }
    }

    setListLoading(true)

    apiRequest<void>('/api/voca/favorites/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: legacyIds }),
    })
      .then(() => {
        if (cancelled) {
          return
        }
        saveWordFavoriteMigrationDone(true)
        clearLegacyWordFavoriteIds()
        clearLegacyFavoritesOnly()
        setFavoriteMigrationReady(true)
        setListRefreshToken((prev) => prev + 1)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setToast({ type: 'error', message: '기존 즐겨찾기 마이그레이션에 실패했습니다.' })
        setFavoriteMigrationReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [favoriteMigrationReady])

  useEffect(() => {
    if (studyMaskMode === 'hideMeaning' && editingMeaningId !== null) {
      setEditingMeaningId(null)
      setEditingMeaningText('')
      setEditingMeaningError(null)
    }
  }, [editingMeaningId, studyMaskMode])

  useEffect(() => {
    if (visibleCardIds.length === 0) {
      if (activeStudyCardId !== null) {
        setActiveStudyCardId(null)
      }
      return
    }

    if (activeStudyCardId === null || !visibleCardIds.includes(activeStudyCardId)) {
      setActiveStudyCardId(visibleCardIds[0] ?? null)
    }
  }, [activeStudyCardId, visibleCardIds])

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

    if (!favoriteMigrationReady) {
      return () => {
        cancelled = true
      }
    }

    async function fetchList() {
      setListLoading(true)
      const keyword = debouncedKeyword.trim()
      const tag = resolvedTagQuery

      const buildParams = (targetPage: number) => {
        const params = new URLSearchParams({
          page: String(targetPage),
          size: String(PAGE_SIZE),
        })

        if (keyword.length > 0) {
          params.set('keyword', keyword)
        }
        if (tag.length > 0) {
          params.set('tag', tag)
        }
        if (showFavoritesOnly) {
          params.set('favoriteOnly', 'true')
        }
        if (favoriteFirst) {
          params.set('favoriteFirst', 'true')
        }

        return params
      }

      try {
        const data = await apiRequest<PageResponse<VocaResponse>>(`/api/voca?${buildParams(page).toString()}`)
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
  }, [page, debouncedKeyword, favoriteFirst, favoriteMigrationReady, listRefreshToken, resolvedTagQuery, showFavoritesOnly])

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

  const isCardRevealedByCurrentStudyMode = (itemId: number): boolean => {
    if (studyMaskMode === 'hideWord') {
      return Boolean(revealedCardIdsByMode.hideWord[itemId])
    }
    if (studyMaskMode === 'hideMeaning') {
      return Boolean(revealedCardIdsByMode.hideMeaning[itemId])
    }
    return true
  }

  const toggleCardRevealByCurrentStudyMode = (itemId: number) => {
    if (studyMaskMode === 'off') {
      return
    }
    const modeKey = studyMaskMode === 'hideWord' ? 'hideWord' : 'hideMeaning'
    setRevealedCardIdsByMode((prev) => ({
      ...prev,
      [modeKey]: {
        ...prev[modeKey],
        [itemId]: !prev[modeKey][itemId],
      },
    }))
  }

  const resetVisibleStudyRevealState = () => {
    if (studyMaskMode === 'off' || visibleCardIds.length === 0) {
      return
    }

    const modeKey = studyMaskMode === 'hideWord' ? 'hideWord' : 'hideMeaning'
    setRevealedCardIdsByMode((prev) => {
      const nextMode = { ...prev[modeKey] }
      visibleCardIds.forEach((itemId) => {
        delete nextMode[itemId]
      })
      return {
        ...prev,
        [modeKey]: nextMode,
      }
    })
  }

  const resetAllStudyRevealState = () => {
    setRevealedCardIdsByMode({
      hideWord: {},
      hideMeaning: {},
    })
  }

  const setWordFavorite = async (item: VocaResponse, favorite: boolean) => {
    try {
      const updated = await apiRequest<VocaResponse>(`/api/voca/${item.id}/favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite }),
      })

      if (showFavoritesOnly || favoriteFirst) {
        setListRefreshToken((prev) => prev + 1)
        return
      }

      setPageData((prev) => {
        if (!prev) {
          return prev
        }
        return {
          ...prev,
          items: prev.items.map((entry) => (entry.id === item.id ? updated : entry)),
        }
      })
    } catch (error) {
      if (error instanceof ApiError) {
        setToast({ type: 'error', message: error.message })
      } else {
        setToast({ type: 'error', message: '즐겨찾기 저장에 실패했습니다.' })
      }
    }
  }

  const moveActiveStudyCard = (step: number) => {
    if (visibleCardIds.length === 0) {
      return
    }
    const currentIndex = activeStudyCardId !== null ? visibleCardIds.indexOf(activeStudyCardId) : -1
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = (baseIndex + step + visibleCardIds.length) % visibleCardIds.length
    const nextId = visibleCardIds[nextIndex]
    if (typeof nextId !== 'number') {
      return
    }

    setActiveStudyCardId(nextId)
    window.requestAnimationFrame(() => {
      const cardElement = document.getElementById(`word-card-${nextId}`)
      cardElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      cardElement?.focus()
    })
  }

  const addStudyScore = async (itemId: number, result: StudyScoreResult) => {
    try {
      const updated = await apiRequest<VocaResponse>(`/api/voca/${itemId}/study-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result }),
      })

      setPageData((prev) => {
        if (!prev) {
          return prev
        }
        return {
          ...prev,
          items: prev.items.map((entry) => (entry.id === itemId ? updated : entry)),
        }
      })
    } catch (error) {
      if (error instanceof ApiError) {
        setToast({ type: 'error', message: error.message })
      } else {
        setToast({ type: 'error', message: '정답 기록 저장에 실패했습니다.' })
      }
    }
  }

  useEffect(() => {
    const handleStudyShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'n' || key === 'arrowdown') {
        event.preventDefault()
        moveActiveStudyCard(1)
        return
      }
      if (key === 'p' || key === 'arrowup') {
        event.preventDefault()
        moveActiveStudyCard(-1)
        return
      }

      if (studyMaskMode === 'off' || activeStudyCardId === null) {
        return
      }

      if (event.key === ' ') {
        event.preventDefault()
        toggleCardRevealByCurrentStudyMode(activeStudyCardId)
        return
      }

      if (!isCardRevealedByCurrentStudyMode(activeStudyCardId)) {
        return
      }

      if (!showStudyScoreButtons) {
        return
      }

      if (key === '1') {
        event.preventDefault()
        void addStudyScore(activeStudyCardId, 'CORRECT')
        return
      }

      if (key === '2') {
        event.preventDefault()
        void addStudyScore(activeStudyCardId, 'PARTIAL')
        return
      }

      if (key === '3') {
        event.preventDefault()
        void addStudyScore(activeStudyCardId, 'WRONG')
      }
    }

    document.addEventListener('keydown', handleStudyShortcut)
    return () => {
      document.removeEventListener('keydown', handleStudyShortcut)
    }
  }, [activeStudyCardId, revealedCardIdsByMode, showStudyScoreButtons, studyMaskMode, visibleCardIds])

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
      setRevealedCardIdsByMode((prev) => {
        const nextHideWord = { ...prev.hideWord }
        const nextHideMeaning = { ...prev.hideMeaning }
        delete nextHideWord[item.id]
        delete nextHideMeaning[item.id]
        return {
          hideWord: nextHideWord,
          hideMeaning: nextHideMeaning,
        }
      })
      if (activeStudyCardId === item.id) {
        setActiveStudyCardId(null)
      }
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
    const selectedTags = sortTagsByDisplayOrder(collapseHierarchicalTags(quickTags), tagOrderIndex)

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
      const nextTags = sortTagsByDisplayOrder(toggleTagPath(prev, PRONUNCIATION_TAG), tagOrderIndex)
      setRecentTags(() => {
        const recentNext = normalizeRecentTags(nextTags)
        saveRecentTags(recentNext)
        return recentNext
      })
      return nextTags
    })
  }

  const toggleQuickFavoriteTag = (tagPath: string) => {
    setQuickTags((prev) => {
      const nextTags = sortTagsByDisplayOrder(toggleTagPath(prev, tagPath), tagOrderIndex)
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
    setTagInput(tagPreferences.metadataByPath[tagPath]?.alias ?? tagPath)
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
    const tags = sortTagsByDisplayOrder(item.tags ?? [], tagOrderIndex)
    const examples = item.examples ?? []
    const shouldShowTags = showCardTags && tags.length > 0
    const shouldShowExamples = showCardExamples && examples.length > 0
    const isExamplesOpen = Boolean(openExampleIds[item.id])
    const isMeaningEditing = editingMeaningId === item.id
    const isActiveStudyCard = activeStudyCardId === item.id
    const isCardRevealEnabled = studyMaskMode !== 'off'
    const isWordMasked = studyMaskMode === 'hideWord' && !revealedCardIdsByMode.hideWord[item.id]
    const isMeaningMasked = studyMaskMode === 'hideMeaning' && !revealedCardIdsByMode.hideMeaning[item.id]
    const isCurrentStudyTargetRevealed = studyMaskMode === 'off' ? true : isCardRevealedByCurrentStudyMode(item.id)
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
    const studyCorrectCount = Math.max(0, item.studyCorrectCount ?? 0)
    const studyPartialCount = Math.max(0, item.studyPartialCount ?? 0)
    const studyWrongCount = Math.max(0, item.studyWrongCount ?? 0)
    const studyAttemptCount = studyCorrectCount + studyPartialCount + studyWrongCount
    const hasStudyScore = studyAttemptCount > 0
    const studyAccuracy = studyAttemptCount > 0 ? Math.round((studyCorrectCount / studyAttemptCount) * 100) : null
    const revealTargetLabel = studyMaskMode === 'hideWord' ? '단어' : '뜻'
    const isFavoriteWord = Boolean(item.favorite)

    return (
      <article
        key={item.id}
        id={`word-card-${item.id}`}
        tabIndex={0}
        className={`rounded-2xl border border-sky-100 bg-white p-4 shadow-sm outline-none transition-shadow duration-200 ${
          isCardRevealEnabled ? 'cursor-pointer hover:shadow-md' : ''
        } ${isActiveStudyCard ? 'ring-2 ring-sky-300' : ''}`}
        onFocus={() => setActiveStudyCardId(item.id)}
        onMouseEnter={() => setActiveStudyCardId(item.id)}
        onClick={(event) => {
          setActiveStudyCardId(item.id)
          if (!isCardRevealEnabled || shouldSkipCardRevealToggle(event.target)) {
            return
          }
          toggleCardRevealByCurrentStudyMode(item.id)
        }}
        title={
          isCardRevealEnabled
            ? `${revealTargetLabel}를 카드 클릭으로 ${isWordMasked || isMeaningMasked ? '공개' : '재가림'}할 수 있습니다.`
            : undefined
        }
      >
        <div className="flex flex-col">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {!isWordMasked ? (
                <>
                  <h3 className="nanum-gothic-bold animate-fade-up text-xl text-stone-900">{item.word}</h3>
                  {!item.ipa && <NaverDictionaryLink word={item.word} title="네이버 영어사전 열기" />}
                  {item.ipa && (
                    <button
                      type="button"
                      className={`animate-fade-up font-mono text-sm ${
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
                  {item.ipa && <NaverDictionaryLink word={item.word} title="네이버 영어사전 열기" />}
                </>
              ) : (
                <p className="animate-fade-up rounded-lg border border-dashed border-sky-300 bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-800">
                  클릭해서 보기
                </p>
              )}

              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-bold transition ${
                    isFavoriteWord
                      ? 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200'
                      : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  }`}
                  onClick={() => {
                    void setWordFavorite(item, !isFavoriteWord)
                  }}
                  title={isFavoriteWord ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                  aria-label={isFavoriteWord ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                >
                  {isFavoriteWord ? '★' : '☆'}
                </button>
                {showCardActions && (
                  <div className="flex items-center gap-2">
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
            </div>

            {isMeaningMasked && (
              <p className="mt-2 animate-fade-up rounded-xl border border-dashed border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800">
                클릭해서 보기
              </p>
            )}

            {!isMeaningMasked && !isMeaningEditing && (
              <>
                {visibleMeaningLines.length > 0 ? (
                  <div
                    className="mt-1 flex animate-fade-up cursor-text flex-wrap items-start gap-2"
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
                    className="mt-1 animate-fade-up cursor-text text-sm text-stone-500"
                    onDoubleClick={() => startMeaningInlineEdit(item)}
                    title="뜻을 더블클릭해서 빠르게 수정"
                  >
                    뜻이 없습니다.
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

            {!isMeaningMasked && isMeaningEditing && (
              <div className="mt-1 animate-fade-up rounded-xl border border-sky-200 bg-sky-50/60 p-2">
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

            {studyMaskMode !== 'off' && ((showStudyScoreSummary && hasStudyScore) || showStudyScoreButtons) && (
              <div className="mt-2 rounded-xl bg-sky-50/70 px-3 py-2">
                {showStudyScoreSummary && hasStudyScore && (
                  <>
                    <p className="text-xs font-semibold text-sky-900">정답률 {studyAccuracy}% · 시도 {studyAttemptCount}회</p>
                    <p className="mt-1 text-[11px] text-sky-800/90">
                      알았음 {studyCorrectCount} · 헷갈림 {studyPartialCount} · 모름 {studyWrongCount}
                    </p>
                  </>
                )}
                {showStudyScoreButtons && (
                  <div className={`grid gap-2 ${hasStudyScore ? 'mt-2 grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}>
                    <button
                      type="button"
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm font-bold text-emerald-900 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        void addStudyScore(item.id, 'CORRECT')
                      }}
                      disabled={!isCurrentStudyTargetRevealed}
                    >
                      1 알았음
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        void addStudyScore(item.id, 'PARTIAL')
                      }}
                      disabled={!isCurrentStudyTargetRevealed}
                    >
                      2 헷갈림
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-3 text-sm font-bold text-rose-900 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        void addStudyScore(item.id, 'WRONG')
                      }}
                      disabled={!isCurrentStudyTargetRevealed}
                    >
                      3 모름
                    </button>
                  </div>
                )}
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
                    {getTagChipLabel(tag, tagPreferences.metadataByPath)}
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

        <div className="w-full max-w-5xl space-y-2">
          <form
            className="grid gap-2 sm:justify-end sm:grid-cols-[max-content_11.25rem_11.25rem_max-content]"
            onSubmit={onQuickAdd}
          >
            <div className="h-full w-fit rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs text-stone-900">
              <div className="flex items-center gap-3 pb-1">
                <button
                  type="button"
                  className="shrink-0 text-left outline-none transition hover:text-sky-900"
                  onClick={(event) => {
                    setQuickTagModalAnchor(event.currentTarget)
                    setQuickTagModalOpen(true)
                  }}
                  disabled={quickSaving}
                >
                  <p className="whitespace-nowrap font-semibold text-sky-800">태그 선택</p>
                  <p className="mt-1 whitespace-nowrap text-stone-500">
                    {displayedQuickTags.length > 0 ? `${displayedQuickTags.length}개 선택됨` : '선택된 태그 없음'}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
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
                  <FavoriteTagQuickBar
                    favoriteTags={tagPreferences.favoriteTags}
                    selectedTags={displayedQuickTags}
                    metadataByPath={tagPreferences.metadataByPath}
                    disabled={quickSaving || quickLookupLoading}
                    onToggleTag={toggleQuickFavoriteTag}
                  />
                </div>
              </div>
            </div>

            {displayedQuickTags.length > 0 && (
              <div className="flex flex-wrap gap-2 sm:col-start-1 sm:row-start-2">
                {displayedQuickTags.map((tagPath) => (
                  <button
                    key={`quick-selected-${tagPath}`}
                    type="button"
                    className="max-w-full rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800"
                    onClick={() => {
                      setQuickTags((prev) => sortTagsByDisplayOrder(prev.filter((tag) => tag !== tagPath), tagOrderIndex))
                    }}
                    title={`클릭해서 제거 · #${tagPath}`}
                  >
                    <span className="truncate">{getTagChipLabel(tagPath, tagPreferences.metadataByPath)}</span>
                  </button>
                ))}
              </div>
            )}

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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-900">암기 모드: {studyModeLabel}</span>
          {shuffleCards && <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-900">랜덤 순서 ON</span>}
          {showFavoritesOnly && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900">즐겨찾기만</span>}
          {favoriteFirst && <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-800">즐겨찾기 우선</span>}
          {studyMaskMode !== 'off' && (
            <span className="rounded-full bg-stone-100 px-2 py-1 text-stone-700">
              {showStudyScoreButtons ? 'Space 공개/재가림 · 1/2/3 채점 · N/P 이동' : 'Space 공개/재가림 · N/P 이동'}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {studyMaskMode !== 'off' && (
            <>
              <button
                type="button"
                className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
                onClick={resetVisibleStudyRevealState}
              >
                현재 페이지 다시 가리기
              </button>
              <button
                type="button"
                className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
                onClick={resetAllStudyRevealState}
              >
                전체 다시 가리기
              </button>
            </>
          )}
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
              <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-sky-200 bg-white p-3 shadow-lg">
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
                <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-stone-800">
                  <input
                    type="checkbox"
                    checked={showFavoritesOnly}
                    onChange={(event) => {
                      setShowFavoritesOnly(event.target.checked)
                      setPage(0)
                    }}
                  />
                  즐겨찾기만
                </label>
                <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-stone-800">
                  <input
                    type="checkbox"
                    checked={favoriteFirst}
                    onChange={(event) => {
                      setFavoriteFirst(event.target.checked)
                      setPage(0)
                    }}
                  />
                  즐겨찾기 우선
                </label>
                <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-stone-800">
                  <input
                    type="checkbox"
                    checked={showStudyScoreSummary}
                    onChange={(event) => setShowStudyScoreSummary(event.target.checked)}
                  />
                  암기 정답률
                </label>
                <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-stone-800">
                  <input
                    type="checkbox"
                    checked={showStudyScoreButtons}
                    onChange={(event) => setShowStudyScoreButtons(event.target.checked)}
                  />
                  암기 채점 버튼
                </label>

                <div className="mt-3 border-t border-sky-100 pt-2">
                  <p className="mb-1 text-xs font-semibold text-stone-500">암기 모드</p>
                  <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-stone-800">
                    <input type="radio" name="study-mask-mode" checked={studyMaskMode === 'off'} onChange={() => setStudyMaskMode('off')} />
                    끔
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-stone-800">
                    <input
                      type="radio"
                      name="study-mask-mode"
                      checked={studyMaskMode === 'hideWord'}
                      onChange={() => setStudyMaskMode('hideWord')}
                    />
                    단어 가리기
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-stone-800">
                    <input
                      type="radio"
                      name="study-mask-mode"
                      checked={studyMaskMode === 'hideMeaning'}
                      onChange={() => setStudyMaskMode('hideMeaning')}
                    />
                    뜻 가리기
                  </label>
                </div>

                <div className="mt-3 border-t border-sky-100 pt-2">
                  <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-stone-800">
                    <input type="checkbox" checked={shuffleCards} onChange={(event) => setShuffleCards(event.target.checked)} />
                    랜덤 순서
                  </label>
                </div>

                <div className="mt-3 border-t border-sky-100 pt-2">
                  <p className="text-[11px] text-stone-600">
                    {showStudyScoreButtons ? '단축키: Space 공개/재가림, 1/2/3 채점, N/P 이동' : '단축키: Space 공개/재가림, N/P 이동'}
                  </p>
                </div>
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
      </div>

      <div className="mt-4">
        {listLoading && <p className="text-sm text-stone-500">목록 불러오는 중...</p>}

        {!listLoading && listItems.length === 0 && (
          <p className="rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500">
            {showFavoritesOnly ? '즐겨찾기한 단어가 없습니다.' : '검색 조건에 맞는 단어가 없습니다.'}
          </p>
        )}

        {!listLoading && listItems.length > 0 && (
          <>
            {!groupByDate && <div className="grid gap-4 sm:grid-cols-2">{orderedItems.map((item) => renderWordCard(item))}</div>}

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
        key={`quick-tag-modal-${quickTagModalOpen ? 'open' : 'closed'}-${displayedQuickTags.join('|')}`}
        open={quickTagModalOpen}
        title="빠른 추가 태그 선택"
        selectedTags={displayedQuickTags}
        loading={tagTreeLoading}
        anchorEl={quickTagModalAnchor}
        tagPreferences={tagPreferences}
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
