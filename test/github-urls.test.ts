import { type TestContext } from 'vitest'
import ncu from '../src'
import { type GetGitTagsStub, stubGetGitTags } from './helpers/stubGetGitTags'

vi.mock('parse-github-url', async importOriginal => {
  const { createParseGitHubUrlMock } = await import('./helpers/stubParseGitHubUrl')
  return createParseGitHubUrlMock(importOriginal)
})

// const githubUrlMap = new Map([
//   [
//     'https://github.com/raineorshine/ncu-test-v2#1.0.0',
//     { auth: null, protocol: 'https:', host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: '1.0.0' },
//   ],
//   [
//     'raineorshine/ncu-test-v2#1.0.0',
//     { auth: null, protocol: null, host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: '1.0.0' },
//   ],
//   [
//     'https://github.com/raineorshine/ncu-test-v2#semver:^1.0.0',
//     { auth: null, protocol: 'https:', host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: 'semver:^1.0.0' },
//   ],
//   [
//     'https://github.com/raineorshine/ncu-test-v2#2.0.0',
//     { auth: null, protocol: 'https:', host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: '2.0.0' },
//   ],
//   [
//     'https://github.com/raineorshine/ncu-test-v2#2.0.0',
//     { auth: null, protocol: 'https:', host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: '2.0.0' },
//   ],
//   [
//     'github:raineorshine/ncu-test-v2#1.0.0',
//     { auth: null, protocol: 'github:', host: 'raineorshine', path: 'ncu-test-v2', branch: '1.0.0' },
//   ],
//   [
//     'github:raineorshine/ncu-test-v2#2.0.0',
//     { auth: null, protocol: 'github:', host: 'raineorshine', path: 'ncu-test-v2', branch: '2.0.0' },
//   ],
//   [
//     'raineorshine/ncu-test-v2#2.0.0',
//     { auth: null, protocol: null, host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: '2.0.0' },
//   ],
//   [
//     'https://github.com/raineorshine/ncu-test-v2#semver:^2.0.0',
//     { auth: null, protocol: 'https:', host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: 'semver:^2.0.0' },
//   ],
// ])

// type ParseGitHubUrl = (declaration: string) => { branch: string | null; [key: string]: any }

// vi.mock('parse-github-url', async importOriginal => {
//   const actual = (await importOriginal()) as { default: ParseGitHubUrl }

//   return {
//     ...actual,
//     default: vi.fn(declaration => {
//       // Check our map first
//       if (githubUrlMap.has(declaration)) {
//         return githubUrlMap.get(declaration)
//       }

//       const result = actual.default(declaration)
//       const { auth, protocol, host, path, branch } = result

//       // If not in map, warn and call the real library
//       console.warn(
//         `[MOCK WARNING] 'parse-github-url' called with unknown declaration: "${declaration}". Please update your test fixtures.
//         with:
//         ['${declaration}', ${JSON.stringify({ auth, protocol, host, path, branch })}]`,
//       )

//       return result
//     }),
//   }
// })

describe('github urls', () => {
  let gitTagsStub: GetGitTagsStub

  beforeAll(async () => {
    gitTagsStub = await stubGetGitTags('github-urls')
  })

  afterAll(() => {
    gitTagsStub?.mockRestore({
      task: { result: { state: 'pass' } },
    } as TestContext)
  })

  it('upgrade github https urls', async () => {
    const upgrades = await ncu({
      packageData: {
        dependencies: {
          'ncu-test-v2': 'https://github.com/raineorshine/ncu-test-v2#1.0.0',
        },
      },
    })
    upgrades!.should.deep.equal({
      'ncu-test-v2': 'https://github.com/raineorshine/ncu-test-v2#2.0.0',
    })
  })

  it('upgrade short github urls', async () => {
    const upgrades = await ncu({
      packageData: {
        dependencies: {
          'ncu-test-v2': 'github:raineorshine/ncu-test-v2#1.0.0',
        },
      },
    })
    upgrades!.should.deep.equal({
      'ncu-test-v2': 'github:raineorshine/ncu-test-v2#2.0.0',
    })
  })

  it('upgrade shortest github urls', async () => {
    const upgrades = await ncu({
      packageData: {
        dependencies: {
          'ncu-test-v2': 'raineorshine/ncu-test-v2#1.0.0',
        },
      },
    })
    upgrades!.should.deep.equal({
      'ncu-test-v2': 'raineorshine/ncu-test-v2#2.0.0',
    })
  })

  it('upgrade github http urls with semver', async () => {
    const upgrades = await ncu({
      packageData: {
        dependencies: {
          'ncu-test-v2': 'https://github.com/raineorshine/ncu-test-v2#semver:^1.0.0',
        },
      },
    })
    upgrades!.should.deep.equal({
      'ncu-test-v2': 'https://github.com/raineorshine/ncu-test-v2#semver:^2.0.0',
    })
  })

  // does not work in GitHub actions for some reason
  it.skip('upgrade github git+ssh urls with semver', async () => {
    const upgrades = await ncu({
      packageData: {
        dependencies: {
          'ncu-test-v2': 'git+ssh://git@github.com/raineorshine/ncu-test-v2.git#semver:^1.0.0',
        },
      },
    })
    upgrades!.should.deep.equal({
      'ncu-test-v2': 'git+ssh://git@github.com/raineorshine/ncu-test-v2.git#semver:^2.0.0',
    })
  })
})
