/** .svg files are imported as their XML text (see metro.config.js). Render with <SvgXml xml={…} />. */
declare module '*.svg' {
  const xml: string;
  export default xml;
}
