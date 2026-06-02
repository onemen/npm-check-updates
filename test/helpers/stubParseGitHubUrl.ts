import console from 'node:console'
import fs from 'node:fs'
import path from 'node:path'

type ParseGitHubUrl = (declaration: string) => { branch: string | null; [key: string]: any }

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
        console.warn(`[MOCK WARNING] ${expect.getState()?.testPath}`)
        const entry = JSON.stringify({ [declaration]: { auth, protocol, host, path, branch } })
        fs.appendFileSync(TEMP_LOG, entry + '\n')
        existingFixtures[declaration] = result
      }

      return result
    }),
  }
}
