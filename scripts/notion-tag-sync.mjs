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
  }

  return {
    dryRun,
    onlyTag: onlyTag && onlyTag.length > 0 ? onlyTag : null,
  }
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

function buildWordLine(item) {
  const word = toSingleLine(item.word)
  const meaning = toSingleLine(item.meaningKo)
  const favoritePrefix = item.favorite ? '★ ' : ''

  if (meaning.length === 0) {
    return truncateForNotion(`${favoritePrefix}${word}`)
  }
  return truncateForNotion(`${favoritePrefix}${word} - ${meaning}`)
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

function buildPageBlocks(tag, items) {
  const now = new Date().toISOString()
  const blocks = [
    createHeadingBlock(`#${tag}`),
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

async function fetchAllVocaItems(vocaApiBaseUrl) {
  let page = 0
  const items = []

  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      size: String(DEFAULT_PAGE_SIZE),
    })
    const response = await fetch(`${vocaApiBaseUrl}/api/voca?${params.toString()}`)
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(`단어 목록 조회 실패: ${response.status} ${response.statusText} ${message}`)
    }

    const body = await response.json()
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
  const pageTitle = `#${tag}`
  const existingId = pagesByTitle.get(pageTitle)
  if (existingId) {
    return existingId
  }

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
  return createdId
}

async function clearPageChildren(token, notionVersion, pageId) {
  const blocks = await listBlockChildren(token, notionVersion, pageId)
  for (const block of blocks) {
    await notionRequest(token, notionVersion, 'DELETE', `/blocks/${encodeURIComponent(block.id)}`)
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
  const { dryRun, onlyTag } = parseArgs(process.argv.slice(2))

  const vocaApiBaseUrl = (process.env.VOCA_API_BASE_URL ?? DEFAULT_VOCA_API_BASE_URL).replace(/\/$/, '')
  const notionVersion = process.env.NOTION_VERSION ?? DEFAULT_NOTION_VERSION

  const items = await fetchAllVocaItems(vocaApiBaseUrl)
  const groupedByTag = groupItemsByTag(items)
  const tags = [...groupedByTag.keys()]
    .sort((a, b) => a.localeCompare(b, 'ko-KR'))
    .filter((tag) => (onlyTag ? tag === onlyTag : true))

  if (tags.length === 0) {
    console.log('동기화할 태그가 없습니다.')
    return
  }

  console.log(`전체 단어 ${items.length}개, 태그 ${tags.length}개를 처리합니다.`)

  if (dryRun) {
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

  for (const tag of tags) {
    const tagItems = groupedByTag.get(tag) ?? []
    const pageId = await ensureTagPage(notionToken, notionVersion, notionParentPageId, pagesByTitle, tag)
    const blocks = buildPageBlocks(tag, tagItems)

    console.log(`동기화 시작 #${tag} (${tagItems.length}개)`)
    await clearPageChildren(notionToken, notionVersion, pageId)
    await appendPageBlocks(notionToken, notionVersion, pageId, blocks)
    console.log(`동기화 완료 #${tag}`)
  }

  console.log(`완료: 태그 페이지 ${tags.length}개 동기화`)
}

run().catch((error) => {
  console.error(`실패: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
