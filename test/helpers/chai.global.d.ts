// Global test setup types for Vitest + Chai
import 'vitest/globals'
import 'should'

declare global {
  // Chai's should() returns should object, but we use the prototype extension
  // so this is just for type awareness
  var should: any
}
