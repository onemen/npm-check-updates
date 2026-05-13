import ProgressBar from 'progress'
import Sinon from 'sinon'

/**
 * Silences the ProgressBar output during tests.
 *
 * Use this helper in `describe` blocks where:
 * - `loglevel` is NOT "silent" or "verbose"
 * - and the ProgressBar would normally write to stdout
 *
 * Returns a `{ restore }` handle so the caller controls lifecycle.
 * Use inside `beforeEach`/`afterEach` hooks (not inside `it()` bodies),
 * because Vitest does not support registering lifecycle hooks inside test bodies.
 *
 * @example
 * describe('my suite', () => {
 *   let pb: ReturnType<typeof silenceProgressBar>
 *   beforeEach(() => { pb = silenceProgressBar() })
 *   afterEach(() => pb.restore())
 * })
 */
export function silenceProgressBar() {
  const stubs = [
    Sinon.stub(ProgressBar.prototype, 'render'),
    Sinon.stub(ProgressBar.prototype, 'tick'),
    Sinon.stub(ProgressBar.prototype, 'update'),
  ]

  return {
    restore: () => stubs.forEach(s => s.restore()),
  }
}
