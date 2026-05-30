import getInstalledPackages from '../src/lib/getInstalledPackages'
import { stubSpawnCommand } from './helpers/stubSpawnCommand.js'

// test getInstalledPackages since we cannot test runGlobal without additional code for mocking
describe('getInstalledPackages', () => {
  let spawnStub: StubWithSave
  afterEach(context => {
    spawnStub?.mockRestore(context)
  })
  it('execute npm ls', async () => {
    spawnStub = await stubSpawnCommand('getInstalledPackages')
    await getInstalledPackages()
  })
})
