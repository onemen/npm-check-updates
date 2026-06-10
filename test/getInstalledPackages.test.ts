import getInstalledPackages from '../src/lib/getInstalledPackages'
import { type SpawnCommandStub, stubSpawnCommand } from './helpers/stubSpawnCommand'

// test getInstalledPackages since we cannot test runGlobal without additional code for mocking
describe('getInstalledPackages', () => {
  let spawnStub: SpawnCommandStub
  afterEach(context => {
    spawnStub?.mockRestore(context)
  })
  it('execute npm ls', async () => {
    sandbox.createPackageJson({ dependencies: { 'ncu-test-v2': '1.0.0' } })
    spawnStub = await stubSpawnCommand('getInstalledPackages')
    await getInstalledPackages({ cwd: sandbox.cwd })
  })
})
