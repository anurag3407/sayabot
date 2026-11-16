const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, "../..")

const config = getDefaultConfig(projectRoot)

// 1. Watch all files within the monorepo (e.g. packages/core)
config.watchFolders = [monorepoRoot]

// 2. Resolve packages from mobile node_modules and root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
]

// 3. Prevent duplicate react/react-native resolutions
// config.resolver.disableHierarchicalLookup = true

// 4. The shared mascot geometry. Expo 52's Metro ignores package "exports", so map this one
//    subpath straight to its source file instead of turning exports on for every package.
const coreMascot = path.resolve(monorepoRoot, "packages/core/src/mascot.ts")
const upstreamResolve = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@sayabot/core/mascot") return { type: "sourceFile", filePath: coreMascot }
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = config
