import fs from 'fs/promises'
import path from 'node:path'
import { type Options } from '../types/Options'
import { type PackageFile } from '../types/PackageFile'
import { type PackageInfo } from '../types/PackageInfo'
import programError from './programError'

/** Load and parse a package file. */
const loadPackageInfoFromFile = async (options: Options, filepath: string): Promise<PackageInfo> => {
  let pkg: PackageFile, pkgFile: string

  const fullpath = path.resolve(options.cwd || process.cwd(), filepath).replace(/\\/g, '/')

  // assert package.json
  try {
    pkgFile = await fs.readFile(fullpath, 'utf-8')
    pkg = JSON.parse(pkgFile)
  } catch (e) {
    programError(options, `Missing or invalid ${filepath}`)
  }

  // Use relative path when cwd was not provided or not injected internally
  // Use absolute path when cwd was provided explicitly or injected internally by tests
  const returnedFilepath = !options.cwd && !options._internalInjectedCwd ? filepath : fullpath

  return {
    name: undefined, // defined by workspace code only
    pkg,
    pkgFile,
    filepath: returnedFilepath,
  }
}

export default loadPackageInfoFromFile
