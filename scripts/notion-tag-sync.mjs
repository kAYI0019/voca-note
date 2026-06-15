#!/usr/bin/env node

const DEFAULT_VOCA_API_BASE_URL = 'http://localhost:8080'
const DEFAULT_PAGE_SIZE = 100
const DEFAULT_NOTION_VERSION = '2022-06-28'
const MAX_NOTION_RICH_TEXT_LENGTH = 1900
const MAX_NOTION_BLOCKS_PER_APPEND = 100
const NOTION_ID_REGEX = /([0-9a-fA-F]{32})/

function parseArgs(argv) {
  let dryRun = false
  let onlyTag = null
  let minRank = null
  let rankFirst = false

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--dry-run') {
      dryRun = true
      continue
    }
    if (value === '--tag') {
      onlyTag = (argv[index + 1] ?? '').trim()
      index += 1
      continue
    }
    if (value === '--min-rank') {
      minRank = parseRankOption(argv[index + 1], '--min-rank')
      index += 1
      continue
    }
    if (value === '--rank-first') {
      rankFirst = true
      continue
    }
  }

  return {
    dryRun,
    minRank,
    onlyTag: normalizeTag(onlyTag),
    rankFirst,
  }
}

function parseRankOption(value, optionName) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) {
    throw new Error(`${optionName} 옵션은 0 이상 5 이하의 정수를 넣어주세요.`)
  }

  const parsed = Number.parseInt(value.trim(), 10)
  if (parsed < 0 || parsed > 5) {
    throw new Error(`${optionName} 옵션은 0 이상 5 이하만 사용할 수 있습니다.`)
  }

  return parsed
}

function normalizeNotionId(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  const plainHex = trimmed.replace(/-/g, '')
  let hex = ''

  if (/^[0-9a-fA-F]{32}$/.test(plainHex)) {
    hex = plainHex.toLowerCase()
  } else {
    const match = trimmed.match(NOTION_ID_REGEX)
    if (!match) {
      return null
    }
    hex = match[1].toLowerCase()
  }

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function normalizeTag(value) {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('/')
  return normalized.length > 0 ? normalized : null
}

function matchesTagScope(tag, scope) {
  const normalizedTag = normalizeTag(tag)
  const normalizedScope = normalizeTag(scope)

  if (!normalizedScope) {
    return true
  }
  if (!normalizedTag) {
    return false
  }

  const tagKey = normalizedTag.toLowerCase()
  const scopeKey = normalizedScope.toLowerCase()
  return tagKey === scopeKey || tagKey.startsWith(`${scopeKey}/`)
}

function toSingleLine(value) {
  if (typeof value !== 'string') {
    return ''
  }
  return value.replace(/\s+/g, ' ').trim()
}

function truncateForNotion(value) {
  if (value.length <= MAX_NOTION_RICH_TEXT_LENGTH) {
    return value
  }
  return `${value.slice(0, MAX_NOTION_RICH_TEXT_LENGTH - 1)}…`
}

function getItemRank(item) {
  if (typeof item?.rank !== 'number' || !Number.isFinite(item.rank)) {
    return 0
  }
  return Math.min(5, Math.max(0, Math.round(item.rank)))
}

function getItemCreatedAtMs(item) {
  if (typeof item?.createdAt !== 'string') {
    return null
  }

  const parsed = Date.parse(item.createdAt)
  return Number.isFinite(parsed) ? parsed : null
}

function compareItemsForNotion(left, right) {
  const rankDiff = getItemRank(right) - getItemRank(left)
  if (rankDiff !== 0) {
    return rankDiff
  }

  const leftCreatedAtMs = getItemCreatedAtMs(left)
  const rightCreatedAtMs = getItemCreatedAtMs(right)
  if (leftCreatedAtMs !== rightCreatedAtMs) {
    if (leftCreatedAtMs === null) {
      return 1
    }
    if (rightCreatedAtMs === null) {
      return -1
    }
    return rightCreatedAtMs - leftCreatedAtMs
  }

  return toSingleLine(left?.word ?? '').localeCompare(toSingleLine(right?.word ?? ''), 'en')
}

function filterAndSortItems(items, options = {}) {
  const {
    minRank = null,
    rankFirst = false,
  } = options

  let nextItems = Array.isArray(items) ? [...items] : []
  if (minRank !== null) {
    nextItems = nextItems.filter((item) => getItemRank(item) >= minRank)
  }
  if (rankFirst) {
    nextItems.sort(compareItemsForNotion)
  }

  return nextItems
}

function describeSyncOptions(options = {}) {
  const {
    minRank = null,
    onlyTag = null,
    rankFirst = false,
  } = options

  const descriptions = []
  if (onlyTag) {
    descriptions.push(`태그 범위 ${onlyTag}`)
  }
  if (minRank !== null) {
    descriptions.push(`우선순위 ${minRank} 이상`)
  }
  if (rankFirst) {
    descriptions.push('우선순위 높은 순 정렬')
  }

  return descriptions.join(', ')
}

function buildWordLine(item) {
  const word = toSingleLine(item.word)
  const meaning = toSingleLine(item.meaningKo)
  const rank = getItemRank(item)
  const rankPrefix = rank > 0 ? `[R${rank}] ` : ''

  if (meaning.length === 0) {
    return truncateForNotion(`${rankPrefix}${word}`)
  }
  return truncateForNotion(`${rankPrefix}${word} - ${meaning}`)
}

function chunkArray(values, chunkSize) {
  const chunks = []
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }
  return chunks
}

function createParagraphBlock(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: {
            content: truncateForNotion(text),
          },
        },
      ],
    },
  }
}

function createHeadingBlock(text) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [
        {
          type: 'text',
          text: {
            content: truncateForNotion(text),
          },
        },
      ],
    },
  }
}

function createSectionHeadingBlock(text) {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [
        {
          type: 'text',
          text: {
            content: truncateForNotion(text),
          },
        },
      ],
    },
  }
}

function createBulletBlock(text) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        {
          type: 'text',
          text: {
            content: truncateForNotion(text),
          },
        },
      ],
    },
  }
}

function createDividerBlock() {
  return {
    object: 'block',
    type: 'divider',
    divider: {},
  }
}

function buildCanonicalTagPageTitle(tag) {
  return `#${tag}`
}

function buildTagPageTitleCandidates(tag) {
  const canonicalTitle = buildCanonicalTagPageTitle(tag)
  const legacyTitle = toSingleLine(tag)

  if (legacyTitle.length === 0 || legacyTitle === canonicalTitle) {
    return [canonicalTitle]
  }

  return [canonicalTitle, legacyTitle]
}

function buildPageBlocks(tag, items) {
  const now = new Date().toISOString()
  const blocks = [
    createHeadingBlock(buildCanonicalTagPageTitle(tag)),
    createParagraphBlock(`마지막 동기화: ${now}`),
    createParagraphBlock(`단어 수: ${items.length}개`),
    createDividerBlock(),
  ]

  if (items.length === 0) {
    blocks.push(createParagraphBlock('해당 태그에 단어가 없습니다.'))
    return blocks
  }

  for (const item of items) {
    blocks.push(createBulletBlock(buildWordLine(item)))
  }

  return blocks
}

function buildScopedPageBlocks(scopeTag, groupedByTag, tags) {
  const now = new Date().toISOString()
  const totalItemCount = tags.reduce((count, tag) => count + (groupedByTag.get(tag)?.length ?? 0), 0)
  const blocks = [
    createHeadingBlock(buildCanonicalTagPageTitle(scopeTag)),
    createParagraphBlock(`마지막 동기화: ${now}`),
    createParagraphBlock(`태그 수: ${tags.length}개`),
    createParagraphBlock(`단어 수: ${totalItemCount}개`),
    createDividerBlock(),
  ]

  if (tags.length === 0) {
    blocks.push(createParagraphBlock('해당 태그 범위에 단어가 없습니다.'))
    return blocks
  }

  tags.forEach((tag, index) => {
    const items = groupedByTag.get(tag) ?? []
    blocks.push(createSectionHeadingBlock(buildCanonicalTagPageTitle(tag)))
    blocks.push(createParagraphBlock(`단어 수: ${items.length}개`))

    if (items.length === 0) {
      blocks.push(createParagraphBlock('해당 태그에 단어가 없습니다.'))
    } else {
      for (const item of items) {
        blocks.push(createBulletBlock(buildWordLine(item)))
      }
    }

    if (index < tags.length - 1) {
      blocks.push(createDividerBlock())
    }
  })

  return blocks
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestJsonWithRetry(url, init, options = {}) {
  const {
    maxAttempts = 6,
    baseDelayMs = 500,
  } = options

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, init)
    if (response.ok) {
      if (response.status === 204) {
        return null
      }
      const bodyText = await response.text()
      if (bodyText.length === 0) {
        return null
      }
      return JSON.parse(bodyText)
    }

    const retryable = response.status === 429 || response.status >= 500
    const bodyText = await response.text().catch(() => '')
    if (!retryable || attempt === maxAttempts) {
      throw new Error(`HTTP ${response.status} ${response.statusText} - ${bodyText}`)
    }

    const retryAfterSeconds = Number(response.headers.get('retry-after'))
    const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : baseDelayMs * (2 ** (attempt - 1))

    await sleep(retryDelay)
  }

  throw new Error('요청 재시도 횟수를 초과했습니다.')
}

async function fetchAllVocaItems(vocaApiBaseUrl, options = {}) {
  const {
    minRank = null,
    onlyTag = null,
    rankFirst = false,
  } = options

  let page = 0
  const items = []

  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      size: String(DEFAULT_PAGE_SIZE),
    })
    if (minRank !== null) {
      params.set('minRank', String(minRank))
    }
    if (onlyTag) {
      params.set('tag', onlyTag)
    }
    if (rankFirst) {
      params.set('rankFirst', 'true')
    }
    let body
    try {
      body = await requestJsonWithRetry(
        `${vocaApiBaseUrl}/api/voca?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        },
        {
          baseDelayMs: 1000,
        },
      )
    } catch (error) {
      throw new Error(`단어 목록 조회 실패(page=${page}): ${error instanceof Error ? error.message : String(error)}`)
    }

    const currentItems = Array.isArray(body?.items) ? body.items : []
    items.push(...currentItems)

    const totalPages = Number(body?.totalPages ?? 0)
    if (page + 1 >= totalPages) {
      break
    }
    page += 1
  }

  return items
}

function groupItemsByTag(items) {
  const grouped = new Map()

  for (const item of items) {
    const tags = Array.isArray(item?.tags) ? item.tags : []
    for (const rawTag of tags) {
      const tag = normalizeTag(rawTag)
      if (!tag) {
        continue
      }
      if (!grouped.has(tag)) {
        grouped.set(tag, [])
      }
      grouped.get(tag).push(item)
    }
  }

  return grouped
}

function notionHeaders(token, notionVersion) {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': notionVersion,
    'Content-Type': 'application/json',
  }
}

async function notionRequest(token, notionVersion, method, path, body = null) {
  const url = `https://api.notion.com/v1${path}`
  return requestJsonWithRetry(
    url,
    {
      method,
      headers: notionHeaders(token, notionVersion),
      body: body ? JSON.stringify(body) : undefined,
    },
  )
}

async function detectParentIssue(token, notionVersion, candidateId) {
  const pageId = normalizeNotionId(candidateId)
  if (!pageId) {
    throw new Error('NOTION_PARENT_PAGE_ID 형식이 올바르지 않습니다. 페이지 URL 또는 32자리 ID를 넣어주세요.')
  }

  try {
    await notionRequest(token, notionVersion, 'GET', `/pages/${encodeURIComponent(pageId)}`)
    return pageId
  } catch (pageError) {
    try {
      await notionRequest(token, notionVersion, 'GET', `/databases/${encodeURIComponent(pageId)}`)
      throw new Error(
        `NOTION_PARENT_PAGE_ID(${pageId})는 데이터베이스 ID입니다. 일반 페이지 ID를 넣어주세요.`,
      )
    } catch (dbError) {
      if (dbError instanceof Error && dbError.message.includes('데이터베이스 ID')) {
        throw dbError
      }
      throw new Error(
        `NOTION_PARENT_PAGE_ID(${pageId}) 페이지에 접근하지 못했습니다. ` +
          '해당 페이지를 Integration(VOCA_NOTE)에 Share/Invite 했는지 확인해 주세요.',
      )
    }
  }
}

async function listBlockChildren(token, notionVersion, blockId) {
  const children = []
  let hasMore = true
  let nextCursor = null

  while (hasMore) {
    const query = new URLSearchParams({ page_size: '100' })
    if (nextCursor) {
      query.set('start_cursor', nextCursor)
    }

    const data = await notionRequest(
      token,
      notionVersion,
      'GET',
      `/blocks/${encodeURIComponent(blockId)}/children?${query.toString()}`,
    )

    const current = Array.isArray(data?.results) ? data.results : []
    children.push(...current)
    hasMore = Boolean(data?.has_more)
    nextCursor = typeof data?.next_cursor === 'string' ? data.next_cursor : null
  }

  return children
}

async function getChildPageMap(token, notionVersion, parentPageId) {
  const children = await listBlockChildren(token, notionVersion, parentPageId)
  const pagesByTitle = new Map()

  for (const child of children) {
    if (child?.type !== 'child_page') {
      continue
    }
    const title = toSingleLine(child?.child_page?.title ?? '')
    if (title.length === 0) {
      continue
    }
    pagesByTitle.set(title, child.id)
  }

  return pagesByTitle
}

async function ensureTagPage(token, notionVersion, parentPageId, pagesByTitle, tag) {
  const pageTitleCandidates = buildTagPageTitleCandidates(tag)

  for (const pageTitle of pageTitleCandidates) {
    const existingId = pagesByTitle.get(pageTitle)
    if (existingId) {
      return {
        pageId: existingId,
        created: false,
        matchedTitle: pageTitle,
      }
    }
  }

  const pageTitle = pageTitleCandidates[0]
  const created = await notionRequest(token, notionVersion, 'POST', '/pages', {
    parent: {
      page_id: parentPageId,
    },
    properties: {
      title: {
        title: [
          {
            text: {
              content: pageTitle,
            },
          },
        ],
      },
    },
  })

  const createdId = created?.id
  if (typeof createdId !== 'string' || createdId.length === 0) {
    throw new Error(`태그 페이지 생성 후 id를 찾지 못했습니다: ${tag}`)
  }

  pagesByTitle.set(pageTitle, createdId)
  return {
    pageId: createdId,
    created: true,
    matchedTitle: pageTitle,
  }
}

async function clearPageChildrenByDeletingBlocks(token, notionVersion, pageId) {
  const blocks = await listBlockChildren(token, notionVersion, pageId)
  for (const block of blocks) {
    await notionRequest(token, notionVersion, 'DELETE', `/blocks/${encodeURIComponent(block.id)}`)
  }
}

function canFallbackToBlockDelete(error) {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes('HTTP 400')
    && error.message.includes('erase_content')
}

async function clearPageContent(token, notionVersion, pageId) {
  try {
    await notionRequest(token, notionVersion, 'PATCH', `/pages/${encodeURIComponent(pageId)}`, {
      erase_content: true,
    })
    return 'erase_content'
  } catch (error) {
    if (!canFallbackToBlockDelete(error)) {
      throw error
    }

    await clearPageChildrenByDeletingBlocks(token, notionVersion, pageId)
    return 'delete_blocks'
  }
}

async function appendPageBlocks(token, notionVersion, pageId, blocks) {
  const chunks = chunkArray(blocks, MAX_NOTION_BLOCKS_PER_APPEND)
  for (const chunk of chunks) {
    await notionRequest(token, notionVersion, 'PATCH', `/blocks/${encodeURIComponent(pageId)}/children`, {
      children: chunk,
    })
  }
}

function ensureEnv(name, value) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  throw new Error(`${name} 환경변수가 필요합니다.`)
}

async function run() {
  const {
    dryRun,
    minRank,
    onlyTag,
    rankFirst,
  } = parseArgs(process.argv.slice(2))

  const vocaApiBaseUrl = (process.env.VOCA_API_BASE_URL ?? DEFAULT_VOCA_API_BASE_URL).replace(/\/$/, '')
  const notionVersion = process.env.NOTION_VERSION ?? DEFAULT_NOTION_VERSION

  const syncOptions = {
    minRank,
    onlyTag,
    rankFirst,
  }
  const items = filterAndSortItems(
    await fetchAllVocaItems(vocaApiBaseUrl, syncOptions),
    syncOptions,
  )
  const groupedByTag = groupItemsByTag(items)
  const tags = [...groupedByTag.keys()]
    .sort((a, b) => a.localeCompare(b, 'ko-KR'))
    .filter((tag) => matchesTagScope(tag, onlyTag))

  if (tags.length === 0) {
    console.log('동기화할 태그가 없습니다.')
    return
  }

  const syncOptionSummary = describeSyncOptions(syncOptions)
  if (syncOptionSummary.length > 0) {
    console.log(`전체 단어 ${items.length}개, 태그 ${tags.length}개를 처리합니다. (${syncOptionSummary})`)
  } else {
    console.log(`전체 단어 ${items.length}개, 태그 ${tags.length}개를 처리합니다.`)
  }

  if (dryRun) {
    if (onlyTag) {
      console.log(`[DRY RUN] #${onlyTag}: ${items.length}개를 단일 페이지로 동기화합니다.`)
    }
    tags.forEach((tag) => {
      const count = groupedByTag.get(tag)?.length ?? 0
      console.log(`[DRY RUN] #${tag}: ${count}개`)
    })
    return
  }

  const notionToken = ensureEnv('NOTION_TOKEN', process.env.NOTION_TOKEN)
  const parentInput = ensureEnv('NOTION_PARENT_PAGE_ID', process.env.NOTION_PARENT_PAGE_ID)
  const notionParentPageId = await detectParentIssue(notionToken, notionVersion, parentInput)

  const pagesByTitle = await getChildPageMap(notionToken, notionVersion, notionParentPageId)

  if (onlyTag) {
    const {
      pageId,
      created,
      matchedTitle,
    } = await ensureTagPage(notionToken, notionVersion, notionParentPageId, pagesByTitle, onlyTag)
    const blocks = buildScopedPageBlocks(onlyTag, groupedByTag, tags)

    if (created) {
      console.log(`새 페이지 생성 후 범위 동기화 #${onlyTag} (${items.length}개, ${tags.length}개 태그)`)
    } else {
      console.log(`기존 페이지 갱신 #${onlyTag} (${items.length}개, ${tags.length}개 태그, title=${matchedTitle})`)
    }
    const clearMode = await clearPageContent(notionToken, notionVersion, pageId)
    if (clearMode === 'erase_content') {
      console.log(`페이지 내용 초기화 완료 #${onlyTag} (mode=erase_content)`)
    } else {
      console.log(`페이지 내용 초기화 완료 #${onlyTag} (mode=delete_blocks)`)
    }
    await appendPageBlocks(notionToken, notionVersion, pageId, blocks)
    console.log(`동기화 완료 #${onlyTag}`)
    console.log('완료: 범위 페이지 1개 동기화')
    return
  }

  for (const tag of tags) {
    const tagItems = groupedByTag.get(tag) ?? []
    const {
      pageId,
      created,
      matchedTitle,
    } = await ensureTagPage(notionToken, notionVersion, notionParentPageId, pagesByTitle, tag)
    const blocks = buildPageBlocks(tag, tagItems)

    if (created) {
      console.log(`새 페이지 생성 후 동기화 #${tag} (${tagItems.length}개)`)
    } else {
      console.log(`기존 페이지 갱신 #${tag} (${tagItems.length}개, title=${matchedTitle})`)
    }
    const clearMode = await clearPageContent(notionToken, notionVersion, pageId)
    if (clearMode === 'erase_content') {
      console.log(`페이지 내용 초기화 완료 #${tag} (mode=erase_content)`)
    } else {
      console.log(`페이지 내용 초기화 완료 #${tag} (mode=delete_blocks)`)
    }
    await appendPageBlocks(notionToken, notionVersion, pageId, blocks)
    console.log(`동기화 완료 #${tag}`)
  }

  console.log(`완료: 태그 페이지 ${tags.length}개 동기화`)
}

run().catch((error) => {
  console.error(`실패: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
