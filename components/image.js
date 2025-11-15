const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { mergeStyles, styleNumber, parsePx } = require('../pdf/style');

async function renderImage(node, ctx) {
  const { doc, layout } = ctx;
  const styles = mergeStyles(node);
  let width = styleNumber(styles, 'width', null);
  let height = styleNumber(styles, 'height', null);

  if ((!width || !height) && node.attrs && typeof node.attrs.style === 'string') {
    const map = {};
    node.attrs.style.split(';').forEach((d) => {
      const [k, v] = d.split(':');
      if (k && v) map[k.trim()] = v.trim();
    });
    if (!width && map.width) width = parsePx(map.width, null);
    if (!height && map.height) height = parsePx(map.height, null);
  }

  const src = node.attrs?.src;
  if (!src) return;

  let buf;
  if (/^https?:\/\//i.test(src)) {
    const res = await axios.get(src, { responseType: 'arraybuffer' });
    buf = Buffer.from(res.data);
  } else {
    const localPath = path.isAbsolute(src) ? src : path.resolve(process.cwd(), src);
    buf = fs.readFileSync(localPath);
  }

  const maxW = layout.contentWidth();
  if (!width && !height) width = Math.min(400, maxW);
  if (width && width > maxW) {
    const scale = maxW / width;
    width = maxW;
    if (height) height *= scale;
  }

  const estimatedH = height || (width ? width * 0.5 : 120);
  layout.ensureSpace(estimatedH + 6);

  doc.image(buf, layout.x, layout.y, { width, height });
  layout.cursorToNextLine(estimatedH + 4);
}

module.exports = { renderImage };
