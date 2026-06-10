import fs from 'node:fs'
import path, { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

type ParseGitHubUrl = (declaration: string) => { branch: string | null; [key: string]: any }

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMP_LOG = path.join(__dirname, '../fixtures/temp-github-urls.jsonl')

// Load existing fixtures once for fast lookups
const FIXTURE_PATH = path.join(__dirname, '../fixtures/github-urls.json')
const existingFixtures = fs.existsSync(FIXTURE_PATH) ? JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8')) : {}

/** mock parse-github-url */
export async function createParseGitHubUrlMock(importOriginal: () => Promise<any>) {
  const actual = (await importOriginal()) as { default: ParseGitHubUrl }

  return {
    ...actual,
    default: vi.fn(declaration => {
      if (existingFixtures[declaration]) {
        return existingFixtures[declaration]
      }

      const result = actual.default(declaration)
      const { auth, protocol, host, path, branch } = result

      const isGitHubUrl = declaration.includes('github.com') || declaration.includes('/')
      if (isGitHubUrl) {
        const entry = JSON.stringify({ [declaration]: { auth, protocol, host, path, branch } })
        fs.mkdirSync(dirname(TEMP_LOG), { recursive: true })
        fs.appendFileSync(TEMP_LOG, entry + '\n')
        existingFixtures[declaration] = result
      }

      return result
    }),
  }
}

/** save fixtures/github-urls.json  */
export function saveGithubUrlsFixtures() {
  if (!fs.existsSync(TEMP_LOG)) {
    return
  }

  const existing = fs.existsSync(FIXTURE_PATH) ? JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8')) : {}

  const lines = fs.readFileSync(TEMP_LOG, 'utf-8').split('\n').filter(Boolean)
  const merged = { ...existing }
  for (const line of lines) {
    Object.assign(merged, JSON.parse(line))
  }

  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(sorted, null, 2))

  fs.unlinkSync(TEMP_LOG)
}
