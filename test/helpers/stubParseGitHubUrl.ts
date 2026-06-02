import fs from 'node:fs'
import path from 'node:path'
import { getFixturePath } from './mockUtils'

type ParseGitHubUrl = (declaration: string) => { branch: string | null; [key: string]: any }

const FIXTURE_PATH = getFixturePath('_', 'parse-github-url')

const githubUrlMap = fs.existsSync(FIXTURE_PATH) ? JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8')) : {}
let isDirty = false

/** mock parse-github-url */
export async function createParseGitHubUrlMock(importOriginal: () => Promise<any>) {
  const actual = (await importOriginal()) as { default: ParseGitHubUrl }

  afterAll(() => {
    if (Object.keys(githubUrlMap).length) {
      console.log('Final GitHub URL Map:', isDirty, Object.keys(githubUrlMap).length)
    }
    if (isDirty) {
      const sortedMap = Object.fromEntries(Object.entries(githubUrlMap).sort(([a], [b]) => a.localeCompare(b)))
      fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true })
      fs.writeFileSync(FIXTURE_PATH, JSON.stringify(sortedMap, null, 2))
    }
  })

  return {
    ...actual,
    default: vi.fn(declaration => {
      if (githubUrlMap[declaration]) {
        return githubUrlMap[declaration]
      }

      const result = actual.default(declaration)
      const { auth, protocol, host, path, branch } = result

      // If not in map, warn and return result from the real library
      const isGitHubUrl = declaration.includes('github.com') || declaration.includes('/')
      if (isGitHubUrl) {
        isDirty = true
        // console.warn(
        //   `[MOCK WARNING] 'parse-github-url' called with unknown declaration: "${declaration}".
        //  testPath: ${expect.getState()?.testPath}
        //  currentTestName: ${expect.getState()?.currentTestName},
        //  Please update your test fixtures with:
        // ['${declaration}', ${JSON.stringify({ auth, protocol, host, path, branch })}]`,
        // )
        console.warn(`[MOCK WARNING] ${expect.getState()?.testPath}`)
        githubUrlMap[declaration] = { auth, protocol, host, path, branch }
      }

      return result
    }),
  }
}
