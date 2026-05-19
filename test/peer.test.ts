import fs from 'node:fs/promises'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import ncu from '../src/'
import * as getPeerDependenciesFromRegistryModule from '../src/lib/getPeerDependenciesFromRegistry'
import { type Packument } from '../src/types/Packument'
import stubVersions from './helpers/stubVersions'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('peer dependencies', function () {
  beforeAll(async () => {
    const filePath = path.join(__dirname, 'test-data/peer-post-upgrade/peerDependencies.json')
    const peerDepsData = JSON.parse(await fs.readFile(filePath, 'utf-8'))
    const original = getPeerDependenciesFromRegistryModule.default

    // mock getPeerDependenciesFromRegistry
    vi.spyOn(getPeerDependenciesFromRegistryModule, 'default').mockImplementation(async (packageMap, options) => {
      // automatically update mock data if test where changed
      const missingPackageMap = Object.fromEntries(
        Object.entries(packageMap).filter(([pkg, version]) => !peerDepsData[pkg]?.[version]),
      )

      if (Object.keys(missingPackageMap).length > 0) {
        const fetchedPeerDeps = await original(missingPackageMap, options)
        Object.entries(fetchedPeerDeps).forEach(([pkg, peers]) => {
          if (!peerDepsData[pkg]) peerDepsData[pkg] = {}
          peerDepsData[pkg][packageMap[pkg]] = peers
        })
        await fs.writeFile(filePath, JSON.stringify(peerDepsData, null, 2), 'utf-8')
      }

      return Object.fromEntries(
        Object.entries(packageMap).map(([pkg, version]) => [pkg, peerDepsData[pkg]?.[version] || {}]),
      )
    })
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('peer dependencies are ignored by default', async () => {
    const stub = stubVersions({
      'ncu-test-peer': {
        version: '1.0.0',
        versions: { '1.0.0': { version: '1.0.0' } as Packument },
      },
      'ncu-test-return-version': {
        version: '2.0.0',
        versions: {
          '1.0.0': { version: '1.0.0' } as Packument,
          '2.0.0': { version: '2.0.0' } as Packument,
        },
      },
    })
    const upgrades = await ncu({
      packageData: {
        dependencies: {
          'ncu-test-peer': '1.0.0',
          'ncu-test-return-version': '1.0.0',
        },
      },
    })
    upgrades!.should.deep.equal({
      'ncu-test-return-version': '2.0.0',
    })
    stub.mockRestore()
  })

  it('peer dependencies are checked when using option peer', async () => {
    const stub = stubVersions({
      'ncu-test-peer': {
        version: '1.0.0',
        versions: { '1.0.0': { version: '1.0.0' } as Packument },
      },
      'ncu-test-return-version': {
        version: '1.1.0',
        versions: {
          '1.0.0': { version: '1.0.0' } as Packument,
          '1.1.0': { version: '1.1.0' } as Packument,
        },
      },
    })
    const upgrades = await ncu({
      peer: true,
      packageData: {
        dependencies: {
          'ncu-test-peer': '1.0.0',
          'ncu-test-return-version': '1.0.0',
        },
      },
    })
    upgrades!.should.deep.equal({
      'ncu-test-return-version': '1.1.0',
    })
    stub.mockRestore()
  })

  it('peer dependencies are checked iteratively when using option peer', async () => {
    const stub = stubVersions({
      'ncu-test-peer-update': {
        version: '1.1.0',
        versions: {
          '1.0.0': { version: '1.0.0' } as Packument,
          '1.1.0': { version: '1.1.0' } as Packument,
        },
      },
      'ncu-test-return-version': {
        version: '1.1.0',
        versions: {
          '1.0.0': { version: '1.0.0' } as Packument,
          '1.1.0': { version: '1.1.0' } as Packument,
        },
      },
    })
    const upgrades = await ncu({
      peer: true,
      packageData: {
        dependencies: {
          'ncu-test-peer-update': '1.0.0',
          'ncu-test-return-version': '1.0.0',
        },
      },
    })
    upgrades!.should.deep.equal({
      'ncu-test-return-version': '1.1.0',
      'ncu-test-peer-update': '1.1.0',
    })
    stub.mockRestore()
  })

  it('circular peer dependencies are ignored', async () => {
    const vitest = {
      version: '1.6.0',
      versions: {
        '1.3.1': { version: '1.3.1' } as Packument,
        '1.6.0': { version: '1.6.0' } as Packument,
      },
    }
    const stub = stubVersions({
      vitest,
      '@vitest/ui': { ...vitest },
    })
    const upgrades = await ncu({
      peer: true,
      packageData: {
        dependencies: {
          '@vitest/ui': '^1.3.1',
          vitest: '^1.3.1',
        },
      },
    })
    upgrades!.should.contain.keys('@vitest/ui', 'vitest')
    stub.mockRestore()
  })

  // https://github.com/raineorshine/npm-check-updates/issues/1437
  it('git urls are ignored', async () => {
    const upgrades = await ncu({
      peer: true,
      packageData: {
        dependencies: {
          '@libraries/project-4-utils': 'git+gitlab.com/projects/libraries/project-4-utils.git',
        },
      },
    })
    upgrades!.should.deep.equal({})
  })

  it('ignores if post upgrade peers are unmet', async () => {
    const stub = stubVersions({
      '@vitest/ui': {
        version: '1.6.0',
        versions: {
          '1.3.1': {
            version: '1.3.1',
          } as Packument,
          '1.6.0': {
            version: '1.6.0',
          } as Packument,
        },
      },
      vitest: {
        version: '1.6.0',
        versions: {
          '1.3.1': {
            version: '1.3.1',
          } as Packument,
          '1.6.0': {
            version: '1.6.0',
          } as Packument,
        },
      },
      eslint: {
        version: '9.0.0',
        versions: {
          '8.57.0': {
            version: '8.57.0',
          } as Packument,
          '9.0.0': {
            version: '9.0.0',
          } as Packument,
        },
      },
      'eslint-plugin-import': {
        version: '2.29.1',
        versions: {
          '2.29.1': {
            version: '2.29.1',
          } as Packument,
        },
      },
      'eslint-plugin-unused-imports': {
        version: '4.0.0',
        versions: {
          '4.0.0': {
            version: '4.0.0',
          } as Packument,
          '3.0.0': {
            version: '3.0.0',
          } as Packument,
        },
      },
    })
    const cwd = path.join(__dirname, 'test-data/peer-post-upgrade/')
    const upgrades = await ncu({
      cwd,
      peer: true,
      target: packageName => {
        return packageName === 'eslint-plugin-unused-imports' ? 'greatest' : 'minor'
      },
    })
    upgrades!.should.have.all.keys('@vitest/ui', 'vitest')
    stub.mockRestore()
  })

  it('ignores if post upgrade peers are unmet - no upgrades', async () => {
    const stub = stubVersions({
      eslint: {
        version: '9.0.0',
        versions: {
          '8.57.0': {
            version: '8.57.0',
          } as Packument,
          '9.0.0': {
            version: '9.0.0',
          } as Packument,
        },
      },
      'eslint-plugin-import': {
        version: '2.29.1',
        versions: {
          '2.29.1': {
            version: '2.29.1',
          } as Packument,
        },
      },
      'eslint-plugin-unused-imports': {
        version: '4.0.0',
        versions: {
          '4.0.0': {
            version: '4.0.0',
          } as Packument,
          '3.0.0': {
            version: '3.0.0',
          } as Packument,
        },
      },
    })
    const cwd = path.join(__dirname, 'test-data/peer-post-upgrade-no-upgrades/')
    const upgrades = await ncu({
      cwd,
      peer: true,
      target: packageName => {
        return packageName === 'eslint-plugin-unused-imports' ? 'greatest' : 'minor'
      },
    })
    upgrades!.should.deep.equal({})
    stub.mockRestore()
  })

  // https://github.com/raineorshine/npm-check-updates/issues/1604
  it('does not throw when pnpm catalog: references appear as dependency versions with --peer', async () => {
    // In a pnpm workspace, packages can reference catalog entries like "catalog:"
    // instead of a semver version. NCU should not crash when encountering these
    // non-semver specs during peer dependency constraint checking.
    const upgrades = await ncu({
      peer: true,
      packageData: {
        dependencies: {
          // ncu-test-peer@1.0.0 declares: peerDependencies: { 'ncu-test-return-version': '1.0.x' }
          // Checking the peer constraint calls intersects(currentVersion, '1.0.x').
          // If currentVersion is 'catalog:' (non-semver), intersects() throws without the fix.
          'ncu-test-peer': '1.0.0',
          'ncu-test-return-version': 'catalog:',
        },
      },
    })
    // Should complete without throwing; ncu-test-return-version at 'catalog:' is treated as
    // compatible (non-semver) so peer constraint is not considered violated.
    upgrades!.should.be.an('object')
  })
})
