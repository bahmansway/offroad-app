// Turns `import xml from './logo.svg'` into a module that exports the SVG text. Everything else goes
// to Expo's normal Babel transformer.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const expoDir = path.dirname(require.resolve('expo/package.json'));
const metroConfigDir = path.dirname(require.resolve('@expo/metro-config/package.json', { paths: [expoDir] }));
const upstream = require(path.join(metroConfigDir, 'build', 'babel-transformer'));

// Part of Metro's cache key: when this file changes, cached .svg modules are rebuilt.
const OWN_KEY = crypto.createHash('sha1').update(fs.readFileSync(__filename)).digest('hex');

module.exports = {
  ...upstream,
  transform(props) {
    if (props.filename.endsWith('.svg')) {
      return upstream.transform({ ...props, src: `module.exports = ${JSON.stringify(props.src)};` });
    }
    return upstream.transform(props);
  },
  getCacheKey(...args) {
    const base = typeof upstream.getCacheKey === 'function' ? upstream.getCacheKey(...args) : '';
    return `${base}:svg-string:${OWN_KEY}`;
  },
};
