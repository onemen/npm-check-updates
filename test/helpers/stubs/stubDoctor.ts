import fs from 'node:fs/promises'
import path from 'node:path'
import { pm } from '../../../src/lib/doctor'
import { stripRange } from '../../../src/lib/version-util'
import { normalizeCommand } from './utils'

const TARGET_PACKAGE = 'ncu-test-return-version'

type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

const packageManagerLockfiles: Record<PackageManager, string> = {
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
  pnpm: 'pnpm-lock.yaml',
  bun: 'bun.lock',
}

/** get package.json content for a test */
async function getPackageJson(targetCwd: string) {
  try {
    const packageJsonRaw = await fs.readFile(path.join(targetCwd, 'package.json'), 'utf8')
    return JSON.parse(packageJsonRaw)
  } catch {
    return null
  }
}

/**
 * Mocks the internal package manager execution (`pm.run`) during Doctor Mode tests.
 *
 * Instead of spawning heavy native child processes for every dependency installation
 * and script lifecycle trigger, this interceptor manages package versioning and
 * lifecycle states entirely in memory.
 *
 * @remarks
 * By avoiding repetitive native `npm install` and `npm test` process spawns on disk
 * (which are exceptionally slow on Windows), this mock cuts down the suite execution
 * time by roughly 40 seconds.
 *
 * @returns A Vitest SpyInstance wrapper around the `pm.run` implementation.
 */
export function mockPackageManagerRun() {
  const installedVersionsMap = new Map<string, string>()
  const originalRun = pm.run
  return vi.spyOn(pm, 'run').mockImplementation(async (args, options, print, extraOptions) => {
    const targetCwd = options.cwd
    if (!targetCwd) {
      throw new Error(`Mock execution failed: 'options.cwd' is required for command '${args.join(' ')}'`)
    }

    const pkgJson = await getPackageJson(targetCwd)
    const command = args[0]

    // Install/Add does nothing but pretend to succeed
    if (command === 'install' || command === 'add') {
      let detectedVersion = ''

      // Override with explicit CLI argument if present (e.g., package@2.0.0)
      args.forEach(arg => {
        if (!arg.startsWith('-') && arg.includes('@')) {
          const lastAtIndex = arg.lastIndexOf('@')
          if (lastAtIndex > 0 && arg.slice(0, lastAtIndex) === TARGET_PACKAGE) {
            detectedVersion = stripRange(arg.slice(lastAtIndex + 1))
          }
        }
      })

      if (!detectedVersion) {
        if (pkgJson) {
          const allDeps = {
            ...pkgJson.dependencies,
            ...pkgJson.devDependencies,
            ...pkgJson.optionalDependencies,
            ...pkgJson.peerDependencies,
          }
          if (allDeps[TARGET_PACKAGE]) {
            detectedVersion = stripRange(allDeps[TARGET_PACKAGE])
          }
        }
      }

      // Only save to our memory state if we actually tracked a version change for our target
      if (detectedVersion) {
        installedVersionsMap.set(targetCwd, detectedVersion)
      }

      // Create the empty lockfile
      const lockFileName = packageManagerLockfiles[(options.packageManager || 'npm') as PackageManager]
      const lockfilePath = path.join(targetCwd, lockFileName)
      await fs.writeFile(lockfilePath, '', 'utf8')

      const pmType = options.packageManager || 'npm'
      if (!args.includes('--no-save') && (pmType === 'npm' || pmType === 'pnpm') && pkgJson?.scripts?.prepare) {
        return pm.run(['run', 'prepare'], options, print, extraOptions)
      }

      return 'mocked success output'
    }

    // Intercept the test and prepare execution scripts called by doctor
    if (command === 'run' && ['test', 'prepare'].includes(args[1])) {
      if (args[1] === 'test' && pkgJson?.scripts?.test !== 'node test.js') {
        return 'Skipping unhandled test runner script\n'
      }

      const version = installedVersionsMap.get(targetCwd) || '1.0.0'

      // pass on < 2
      // No need to print to the terminal when the test is successful.
      // break on v2.x
      if (version.startsWith('2')) {
        throw new Error('Breaks with v2.x :(')
      }

      return `mocked success output from ${args[1]} script`
    }

    return originalRun(args, options, print, extraOptions)
  })
}

/** mock spawn for doctorTest and doctorInstall options  */
export function mockSpawn() {
  const originalSpawn = pm.spawn
  return vi.spyOn(pm, 'spawn').mockImplementation(async (rawCommand, rawArgs, options, spawnOptions) => {
    const { command, args } = normalizeCommand(rawCommand, rawArgs ?? [])
    const inputStr = JSON.stringify({ command, args })

    switch (inputStr) {
      case '{"command":"npm","args":["run","myinstall"]}':
        // "myinstall": "echo 'Install Success'",
        return { stdout: 'Install Success', stderr: '' }
      case '{"command":"npm","args":["run","mytest"]}':
        // "mytest": "echo Success"
        return { stdout: 'Success', stderr: '' }
      case '{"command":"node","args":["<ROOT>/echo.js","123 456"]}':
        // node echo.js "123 456"
        // echo.js -> console.log(process.argv)
        console.log('simulated echo.js output:', args.at(-1))
        return { stdout: 'Success', stderr: '' }
    }

    return originalSpawn(command, args, options, spawnOptions)
  })
}
