// Metro config for Expo inside a pnpm monorepo.
// - watchFolders lets Metro see the workspace root (shared deps).
// - nodeModulesPaths resolves from both the package and the repo root.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// With node-linker=hoisted deps are flattened, but keep this so a symlinked
// layout still resolves a single React copy.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
