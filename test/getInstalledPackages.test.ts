import getInstalledPackages from '../src/lib/getInstalledPackages'

// test getInstalledPackages since we cannot test runGlobal without additional code for mocking
describe('getInstalledPackages', () => {
  it('execute npm ls', async () => {
    sandbox.createPackageJson({ dependencies: { 'ncu-test-v2': '1.0.0' } })
    await getInstalledPackages({ cwd: sandbox.cwd })
  })
})
