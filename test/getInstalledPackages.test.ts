import getInstalledPackages from '../src/lib/getInstalledPackages'
import { type SpawnCommandStub, stubSpawnCommand } from './helpers/stubSpawnCommand'

// test getInstalledPackages since we cannot test runGlobal without additional code for mocking
describe('getInstalledPackages', () => {
  let spawnStub: SpawnCommandStub
  afterEach(context => {
    spawnStub?.mockRestore(context)
  })
  it('execute npm ls', async () => {
    spawnStub = await stubSpawnCommand('getInstalledPackages')
    await getInstalledPackages()
  })
})
