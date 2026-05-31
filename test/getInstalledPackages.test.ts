import { type MockInstance } from 'vitest'
import getInstalledPackages from '../src/lib/getInstalledPackages'
import { type spawnCommand } from '../src/lib/spawnCommand'
import { stubSpawnCommand } from './helpers/stubSpawnCommand'

// test getInstalledPackages since we cannot test runGlobal without additional code for mocking
describe('getInstalledPackages', () => {
  let spawnStub: MockInstance<typeof spawnCommand>
  afterEach(context => {
    spawnStub?.mockRestore(context)
  })
  it('execute npm ls', async () => {
    spawnStub = await stubSpawnCommand('getInstalledPackages')
    await getInstalledPackages()
  })
})
