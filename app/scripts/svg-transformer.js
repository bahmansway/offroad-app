// Turns `import xml from './logo.svg'` into a module that exports the SVG text. Everything else goes
// to Expo's normal Babel transformer.
const path = require('path');

const expoDir = path.dirname(require.resolve('expo/package.json'));
const metroConfigDir = path.dirname(require.resolve('@expo/metro-config/package.json', { paths: [expoDir] }));
const upstream = require(path.join(metroConfigDir, 'build', 'babel-transformer'));

module.exports = {
  ...upstream,
  transform(props) {
    if (props.filename.endsWith('.svg')) {
      return upstream.transform({ ...props, src: `module.exports = ${JSON.stringify(props.src)};` });
    }
    return upstream.transform(props);
  },
};
