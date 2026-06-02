import fs from 'node:fs'
import path from 'node:path'

/** global setup  */
export function setup() {
  return () => {
    const FIXTURES = path.join(__dirname, '../fixtures/github-urls.json')
    const TEMP_LOG = path.join(__dirname, '../fixtures/temp-github-urls.jsonl')

    if (!fs.existsSync(TEMP_LOG)) {
      return
    }

    // 1. Load existing
    const existing = fs.existsSync(FIXTURES) ? JSON.parse(fs.readFileSync(FIXTURES, 'utf-8')) : {}

    // 2. Read and merge log
    const lines = fs.readFileSync(TEMP_LOG, 'utf-8').split('\n').filter(Boolean)
    const merged = { ...existing }
    for (const line of lines) {
      Object.assign(merged, JSON.parse(line))
    }

    // 3. Sort and Save
    const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)))
    fs.writeFileSync(FIXTURES, JSON.stringify(sorted, null, 2))

    // 4. Cleanup
    fs.unlinkSync(TEMP_LOG)
  }
}
