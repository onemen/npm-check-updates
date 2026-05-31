import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import * as yarn from '../../../src/package-managers/yarn'
import { getPathToLookForYarnrc } from '../../../src/package-managers/yarn'
import { type MockedVersions } from '../../../src/types/MockedVersions'
import { type SpawnCommandStub, stubSpawnCommand } from '../../helpers/stubSpawnCommand'
import stubVersions from '../../helpers/stubVersions'

const __dirname = dirname(fileURLToPath(import.meta.url))

const isWindows = process.platform === 'win32'

// append the local node_modules bin directory to process.env.PATH so local yarn is used during tests
const localBin = path.resolve(__dirname.replace('build/', ''), '../../../node_modules/.bin')
const localYarnSpawnOptions = {
  env: {
    ...process.env,
    PATH: `${process.env.PATH}:${localBin}`,
  },
}

const filteredPath = (process.env.PATH || '')
  .split(path.delimiter)
  .filter(p => !p.includes(path.join('node_modules', '.bin'))) // Avoid running yarn form the node module bin
  .join(path.delimiter)
const cleanEnv = {
  ...process.env,
  PATH: filteredPath,
}

describe('yarn', function () {
  let versionStub: { mockRestore: () => void }
  let spawnStub: SpawnCommandStub
  afterEach(context => {
    versionStub?.mockRestore()
    spawnStub?.mockRestore(context)
  })

  it('latest', async () => {
    const testDir = path.join(__dirname, 'default')
    versionStub = stubVersions({ chalk: '5.0.0' })
    const { version } = await yarn.latest('chalk', '', { cwd: testDir })
    parseInt(version!, 10).should.be.above(3)
  })

  it('greatest', async () => {
    versionStub = stubVersions({ 'ncu-test-greatest-not-newest': '2.0.0-beta' })
    const { version } = await yarn.greatest('ncu-test-greatest-not-newest', '', { pre: true, cwd: __dirname })
    version!.should.equal('2.0.0-beta')
  })

  it('avoids deprecated', async () => {
    const testDir = path.join(__dirname, 'default')
    versionStub = stubVersions({
      version: '1.15.0',
      versions: [
        { version: '1.15.0', deprecated: true },
        { version: '1.16.0', deprecated: true },
        { version: '1.16.1', deprecated: true },
        { version: '1.16.1-lts' },
        { version: '2.0.0-next-4' },
      ],
      time: {},
    } as MockedVersions)
    const { version } = await yarn.minor('popper.js', '1.15.0', { cwd: testDir, pre: true })
    version!.should.equal('1.16.1-lts')
  })

  it('"No lockfile" error should be thrown on list command when there is no lockfile', async () => {
    spawnStub = await stubSpawnCommand('yarn No lockfile error')
    const testDir = path.join(__dirname, 'nolockfile')
    const lockFileErrorMessage = 'No lockfile in this directory. Run `yarn install` to generate one.'
    await yarn.list({ cwd: testDir }, localYarnSpawnOptions).should.eventually.be.rejectedWith(lockFileErrorMessage)
  })

  it('getPeerDependencies v1', async () => {
    spawnStub = await stubSpawnCommand('yarn getPeerDependencies v1')
    const testDir = path.join(__dirname, 'default')
    const spawnOptions = { cwd: testDir, env: cleanEnv }
    await yarn.getPeerDependencies('ncu-test-return-version', '1.0.0', spawnOptions).should.eventually.deep.equal({})
    await yarn.getPeerDependencies('ncu-test-peer', '1.0.0', spawnOptions).should.eventually.deep.equal({
      'ncu-test-return-version': '1.x',
    })
    await yarn.getPeerDependencies('fffffffffffff', '1.0.0', spawnOptions).should.eventually.deep.equal({})
  })

  it('getPeerDependencies v4', async () => {
    spawnStub = await stubSpawnCommand('yarn getPeerDependencies v4')
    const testDir = path.join(__dirname, 'v4')
    const spawnOptions = { cwd: testDir, env: cleanEnv }
    await yarn.getPeerDependencies('ncu-test-return-version', '1.0.0', spawnOptions).should.eventually.deep.equal({})
    await yarn.getPeerDependencies('ncu-test-peer', '1.0.0', spawnOptions).should.eventually.deep.equal({
      'ncu-test-return-version': '1.x',
    })
    await yarn.getPeerDependencies('fffffffffffff', '1.0.0', spawnOptions).should.eventually.deep.equal({})
  })

  describe('npmAuthTokenKeyValue', () => {
    it('npmRegistryServer with trailing slash', () => {
      const authToken = yarn.npmAuthTokenKeyValue({}, 'fortawesome', {
        npmAlwaysAuth: true,
        npmAuthToken: 'MY-AUTH-TOKEN',
        npmRegistryServer: 'https://npm.fontawesome.com/',
      })

      authToken!.should.deep.equal({
        '//npm.fontawesome.com/:_authToken': 'MY-AUTH-TOKEN',
      })
    })

    it('npmRegistryServer without trailing slash', () => {
      const authToken = yarn.npmAuthTokenKeyValue({}, 'fortawesome', {
        npmAlwaysAuth: true,
        npmAuthToken: 'MY-AUTH-TOKEN',
        npmRegistryServer: 'https://npm.fontawesome.com',
      })

      authToken!.should.deep.equal({
        '//npm.fontawesome.com/:_authToken': 'MY-AUTH-TOKEN',
      })
    })

    it('returns null when no npmAlwaysAuth', () => {
      const authToken = yarn.npmAuthTokenKeyValue({}, 'fortawesome', {
        npmAlwaysAuth: true,
        // undefined: npmAuthToken: 'MY-AUTH-TOKEN',
        npmRegistryServer: 'https://npm.fontawesome.com/',
      })

      should.equal(authToken, null)
    })

    it('returns null when no registry server', () => {
      const authToken = yarn.npmAuthTokenKeyValue({}, 'fortawesome', {
        npmAlwaysAuth: true,
        npmAuthToken: 'MY-AUTH-TOKEN',
        // undefined: npmRegistryServer: 'https://npm.fontawesome.com/',
      })

      should.equal(authToken, null)
    })
  })

  describe('getPathToLookForLocalYarnrc', () => {
    it('returns the correct path when using Yarn workspaces', async () => {
      /** Mock for filesystem calls. */
      function readdirMock(path: string): Promise<string[]> {
        switch (path) {
          case '/home/test-repo/packages/package-a':
          case 'C:\\home\\test-repo\\packages\\package-a':
            return Promise.resolve(['index.ts'])
          case '/home/test-repo/packages':
          case 'C:\\home\\test-repo\\packages':
            return Promise.resolve([])
          case '/home/test-repo':
          case 'C:\\home\\test-repo':
            return Promise.resolve(['yarn.lock'])
        }

        throw new Error(`Mock cannot handle path: ${path}.`)
      }

      const yarnrcPath = await getPathToLookForYarnrc(
        {
          cwd: isWindows ? 'C:\\home\\test-repo\\packages\\package-a' : '/home/test-repo/packages/package-a',
        },
        readdirMock,
      )

      should.exist(yarnrcPath)
      yarnrcPath!.should.equal(isWindows ? 'C:\\home\\test-repo\\.yarnrc.yml' : '/home/test-repo/.yarnrc.yml')
    })
  })
})
