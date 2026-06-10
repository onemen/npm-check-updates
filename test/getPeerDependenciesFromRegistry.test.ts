import { chalkInit } from '../src/lib/chalk'
import getPeerDependenciesFromRegistry from '../src/lib/getPeerDependenciesFromRegistry'
import { silenceProgressBar } from './helpers/silenceProgressBar'
import { type SpawnCommandStub, stubSpawnCommand } from './helpers/stubSpawnCommand'

describe('getPeerDependenciesFromRegistry', function () {
  let pb: ReturnType<typeof silenceProgressBar>
  let spawnStub: SpawnCommandStub
  beforeEach(async () => {
    await chalkInit()
    pb = silenceProgressBar()
  })
  afterEach(context => {
    pb.mockRestore()
    spawnStub?.mockRestore(context)
  })

  it('single package', async () => {
    spawnStub = await stubSpawnCommand('single package')
    const data = await getPeerDependenciesFromRegistry({ 'ncu-test-peer': '1.0' }, { cwd: sandbox.cwd })
    data.should.deep.equal({
      'ncu-test-peer': {
        'ncu-test-return-version': '1.x',
      },
    })
  })

  it('single package empty', async () => {
    spawnStub = await stubSpawnCommand('single package empty')
    const data = await getPeerDependenciesFromRegistry({ 'ncu-test-return-version': '1.0' }, { cwd: sandbox.cwd })
    data.should.deep.equal({ 'ncu-test-return-version': {} })
  })

  it('multiple packages', async () => {
    spawnStub = await stubSpawnCommand('multiple packages')
    const data = await getPeerDependenciesFromRegistry(
      {
        'ncu-test-return-version': '1.0.0',
        'ncu-test-peer': '1.0.0',
      },
      { cwd: sandbox.cwd },
    )
    data.should.deep.equal({
      'ncu-test-return-version': {},
      'ncu-test-peer': {
        'ncu-test-return-version': '1.x',
      },
    })
  })
})
