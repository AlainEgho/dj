// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// three.js and its ecosystem ship .cjs / .mjs entry points.
for (const ext of ['cjs', 'mjs']) {
  if (!config.resolver.sourceExts.includes(ext)) config.resolver.sourceExts.push(ext);
}

module.exports = config;
