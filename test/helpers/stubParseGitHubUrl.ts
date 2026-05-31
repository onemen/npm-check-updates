export const githubUrlMap = new Map([
  [
    'https://github.com/raineorshine/ncu-test-v2#1.0.0',
    { auth: null, protocol: 'https:', host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: '1.0.0' },
  ],
  [
    'raineorshine/ncu-test-v2#1.0.0',
    { auth: null, protocol: null, host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: '1.0.0' },
  ],
  [
    'https://github.com/raineorshine/ncu-test-v2#semver:^1.0.0',
    { auth: null, protocol: 'https:', host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: 'semver:^1.0.0' },
  ],
  [
    'https://github.com/raineorshine/ncu-test-v2#2.0.0',
    { auth: null, protocol: 'https:', host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: '2.0.0' },
  ],
  [
    'https://github.com/raineorshine/ncu-test-v2#2.0.0',
    { auth: null, protocol: 'https:', host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: '2.0.0' },
  ],
  [
    'github:raineorshine/ncu-test-v2#1.0.0',
    { auth: null, protocol: 'github:', host: 'raineorshine', path: 'ncu-test-v2', branch: '1.0.0' },
  ],
  [
    'github:raineorshine/ncu-test-v2#2.0.0',
    { auth: null, protocol: 'github:', host: 'raineorshine', path: 'ncu-test-v2', branch: '2.0.0' },
  ],
  [
    'raineorshine/ncu-test-v2#2.0.0',
    { auth: null, protocol: null, host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: '2.0.0' },
  ],
  [
    'https://github.com/raineorshine/ncu-test-v2#semver:^2.0.0',
    { auth: null, protocol: 'https:', host: 'github.com', path: 'raineorshine/ncu-test-v2', branch: 'semver:^2.0.0' },
  ],
  [
    'https://github.com/raineorshine/ncu-test-v2.git#v1.0.0',
    { auth: null, protocol: 'https:', host: 'github.com', path: 'raineorshine/ncu-test-v2.git', branch: 'v1.0.0' },
  ],
  [
    'https://github.com/raineorshine/ncu-test-v2.git#v2.0.0',
    { auth: null, protocol: 'https:', host: 'github.com', path: 'raineorshine/ncu-test-v2.git', branch: 'v2.0.0' },
  ],
])

type ParseGitHubUrl = (declaration: string) => { branch: string | null; [key: string]: any }

/** */
export async function createParseGitHubUrlMock(importOriginal: () => Promise<any>) {
  const actual = (await importOriginal()) as { default: ParseGitHubUrl }

  return {
    ...actual,
    default: vi.fn(declaration => {
      // Check our map first
      if (githubUrlMap.has(declaration)) {
        return githubUrlMap.get(declaration)
      }

      const result = actual.default(declaration)
      const { auth, protocol, host, path, branch } = result

      // If not in map, warn and call the real library
      console.warn(
        `[MOCK WARNING] 'parse-github-url' called with unknown declaration: "${declaration}". Please update your test fixtures.
        with:
        ['${declaration}', ${JSON.stringify({ auth, protocol, host, path, branch })}]`,
      )

      return result
    }),
  }
}
