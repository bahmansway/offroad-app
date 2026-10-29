// Metro config: Expo defaults + .svg files imported as plain strings (rendered with react-native-svg's SvgXml).
// This lets the brand logos in assets/brand/*.svg be used directly, on phones (Expo Go) and on the web.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.transformer.babelTransformerPath = require.resolve('./scripts/svg-transformer.js');
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

module.exports = config;
