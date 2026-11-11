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

module.exports = config
