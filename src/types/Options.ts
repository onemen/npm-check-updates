import { type Cacher } from './Cacher'
import { type Index } from './IndexType'
import { type RunOptions } from './RunOptions'
import { type VersionSpec } from './VersionSpec'

/** Internal, normalized options for all ncu behavior. Includes RunOptions that are specified in the CLI or passed to the ncu module, as well as meta information including CLI arguments, package information, and ncurc config. */
export type Options = RunOptions & {
  args?: any[]
  raw?: Partial<Record<keyof RunOptions, any>>
  cacher?: Cacher
  cli?: boolean
  distTag?: string
  json?: boolean
  nodeEngineVersion?: VersionSpec
  packageData?: string
  peerDependencies?: Index<any>
  rcConfigPath?: string
  // A list of local workspace packages by name.
  // This is used to ignore local workspace packages when fetching new versions.
  workspacePackages?: string[]
  // Indicates that `cwd` was injected internally (e.g., by test helpers such as runNcuCli)
  // rather than provided explicitly by the user via the CLI. This allows the program to
  // preserve the original deep‑mode behavior:
  //   - user‑provided --cwd → output uses relative paths
  //   - internally injected cwd → output uses absolute paths
  //   - no cwd at all → output uses absolute paths
  // This flag is never exposed to users and is only used to avoid altering behavior in tests.
  _internalInjectedCwd?: boolean
}
