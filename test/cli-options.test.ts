import cliOptions from '../src/cli-options'

describe('cli-options', () => {
  it('require long and description properties', () => {
    cliOptions.forEach(option => {
      option.should.have.property('long')
      option.should.have.property('description')
    })
  })
})
