const { JSDOM } = require('jsdom');
const css = require('css');
const fs = require('fs');
const path = require('path');
const { BASE_PT, parsePxWithOptions } = require('./pdf/style');
const vm = require('vm');

if (!vm.constants || !vm.constants.DONT_CONTEXTIFY) {
  vm.constants = { ...(vm.constants || {}), DONT_CONTEXTIFY: {} };
}

function attrsToObject(attrs) {
  const out = {};
  if (!attrs) return out;
  for (const a of attrs) out[a.name] = a.value;
  return out;
}

function calcSpecificity(selector) {
  let a = 0,
    b = 0,
    c = 0;
  const s = selector.replace(/:not\((.*?)\)/g, '$1').replace(/\s+/g, ' ');

  a += (s.match(/#[A-Za-z0-9\-_]+/g) || []).length;

  b += (s.match(/\.[A-Za-z0-9\-_]+/g) || []).length;
  b += (s.match(/\[[^\]]+\]/g) || []).length;
  b += (s.match(/:[a-zA-Z-]+(\(.*?\))?/g) || []).length;

  const tokens = s.split(/[\s>+~]+/);
  tokens.forEach((tok) => {
    const parts = tok.split(/[#.:\[]/);
    const tag = parts[0];
    if (tag && tag !== '*' && /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag)) c += 1;
    c += (tok.match(/::[a-zA-Z-]+/g) || []).length;
  });

  return [a, b, c];
}

function compareSpec(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  if (a[2] !== b[2]) return a[2] - b[2];
  return 0;
}

function parseInlineStyle(styleString) {
  const out = [];
  if (!styleString) return out;
  styleString.split(';').forEach((decl) => {
    const [prop, ...rest] = decl.split(':');
    if (!prop || rest.length === 0) return;
    let value = rest.join(':').trim();
    if (!value) return;
    const important = /\s*!important\s*$/i.test(value);
    value = value.replace(/\s*!important\s*$/i, '').trim();
    const p = prop.trim().toLowerCase();
    if (p) out.push({ property: p, value, important });
  });
  return out;
}

function splitCssValue(value) {
  if (!value) return [];
  const parts = [];
  let buf = '';
  let depth = 0;
  let quote = null;
  const str = String(value).trim();
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (/\s/.test(ch) && depth === 0) {
      if (buf) {
        parts.push(buf);
        buf = '';
      }
      continue;
    }
    buf += ch;
  }
  if (buf) parts.push(buf);
  return parts;
}

const NON_COLOR_TOKENS = new Set([
  'none',
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  'inset',
  'outset',
  'ridge',
  'groove',
  'thin',
  'medium',
  'thick',
]);

function isColorToken(token) {
  if (!token) return false;
  const lower = token.toLowerCase();
  if (lower.startsWith('var(')) return true;
  if (/^#([0-9a-f]{3,8})$/.test(lower)) return true;
  if (/^(rgba?|hsla?)\(.+\)$/.test(lower)) return true;
  if (NON_COLOR_TOKENS.has(lower)) return false;
  return /^[a-z]+$/.test(lower);
}

function isBorderWidthToken(token) {
  if (!token) return false;
  const lower = token.toLowerCase();
  if (['thin', 'medium', 'thick'].includes(lower)) return true;
  return /^-?\d/.test(token);
}

const BORDER_STYLE_TOKENS = new Set([
  'none',
  'hidden',
  'solid',
  'dashed',
  'dotted',
  'double',
  'inset',
  'outset',
  'ridge',
  'groove',
]);

function isBorderStyleToken(token) {
  if (!token) return false;
  return BORDER_STYLE_TOKENS.has(token.toLowerCase());
}

const INHERITABLE = new Set([
  'color',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'line-height',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-style',
  'text-align',
  'text-indent',
  'text-transform',
  'white-space',
  'word-spacing',
  'direction',
]);

function expandShorthand(decl) {
  const { property, value, important } = decl;
  const out = [];
  const push = (propName, val) => out.push({ property: propName, value: val, important });
  if (!property) return [decl];
  const parts = splitCssValue(value);

  if (property === 'margin' || property === 'padding') {
    const [v1, v2, v3, v4] = parts;
    const top = v1;
    const right = parts.length === 1 ? v1 : v2;
    const bottom = parts.length === 1 ? v1 : parts.length === 2 ? v1 : v3;
    const left = parts.length === 4 ? v4 : right;
    push(`${property}-top`, top);
    push(`${property}-right`, right);
    push(`${property}-bottom`, bottom);
    push(`${property}-left`, left);
    return out;
  }

  if (property === 'border' || ['border-top', 'border-right', 'border-bottom', 'border-left'].includes(property)) {
    const width = parts.find((p) => isBorderWidthToken(p));
    const style = parts.find((p) => isBorderStyleToken(p));
    const color = [...parts].reverse().find((p) => isColorToken(p));
    const side = property === 'border' ? '' : property.replace('border-', '') + '-';
    if (width) push(`border-${side}width`, width);
    if (style) push(`border-${side}style`, style);
    if (color) push(`border-${side}color`, color);
    return out.length ? out : [decl];
  }

  if (property === 'background') {
    const color = [...parts].reverse().find((p) => isColorToken(p));
    if (color) push('background-color', color);
    return out.length ? out : [decl];
  }

  if (property === 'font') {
    const tokens = parts;
    let sizeIndex = tokens.findIndex((t) => /\d/.test(t));
    let fontSize = null;
    let lineHeight = null;
    if (sizeIndex >= 0) {
      const sizeToken = tokens[sizeIndex];
      if (sizeToken.includes('/')) {
        const [sz, lh] = sizeToken.split('/');
        fontSize = sz;
        lineHeight = lh;
      } else {
        fontSize = sizeToken;
        const next = tokens[sizeIndex + 1];
        if (next && next.startsWith('/')) lineHeight = next.slice(1);
      }
    }
    const family = sizeIndex >= 0 ? tokens.slice(sizeIndex + 1).join(' ') : null;
    const pre = sizeIndex >= 0 ? tokens.slice(0, sizeIndex) : tokens;
    const fontStyle = pre.find((t) => ['italic', 'oblique'].includes(t.toLowerCase()));
    const fontWeight = pre.find((t) => ['bold', 'bolder', 'lighter'].includes(t.toLowerCase()) || /^[0-9]{3}$/.test(t));
    if (fontStyle) push('font-style', fontStyle);
    if (fontWeight) push('font-weight', fontWeight);
    if (fontSize) push('font-size', fontSize);
    if (lineHeight) push('line-height', lineHeight);
    if (family) push('font-family', family);
    return out.length ? out : [decl];
  }

  return [decl];
}

async function collectCssRules(doc, { fetchExternal = true, externalCssTimeoutMs = 5000 } = {}) {
  const rules = [];
  const page = {};

  const styleTags = Array.from(doc.querySelectorAll('style'));
  let order = 0;
  for (const tag of styleTags) {
    const parsed = css.parse(tag.textContent || '', { silent: true });
    if (!parsed || !parsed.stylesheet) continue;
    for (const rule of parsed.stylesheet.rules || []) {
      if (rule.type === 'page') {
        const decls = [];
        (rule.declarations || [])
          .filter((d) => d.type === 'declaration')
          .forEach((d) => {
            const expanded = expandShorthand({ property: d.property, value: d.value, important: !!d.important });
            expanded.forEach((ex) => decls.push(ex));
          });
        decls.forEach((decl) => {
          page[decl.property] = decl.value;
        });
        continue;
      }
      if (rule.type !== 'rule') continue;
      for (const sel of rule.selectors || []) {
        const decls = [];
        (rule.declarations || [])
          .filter((d) => d.type === 'declaration')
          .forEach((d) => {
            const expanded = expandShorthand({ property: d.property, value: d.value, important: !!d.important });
            expanded.forEach((ex) => decls.push(ex));
          });
        rules.push({
          selector: sel,
          specificity: calcSpecificity(sel),
          declarations: decls,
          order: order++,
        });
      }
    }
  }

  if (fetchExternal) {
    const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;
      try {
        let cssText = '';
        if (/^https?:\/\//i.test(href)) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), externalCssTimeoutMs);
          try {
            const res = await fetch(href, { signal: controller.signal });
            cssText = await res.text();
          } finally {
            clearTimeout(timeoutId);
          }
        } else {
          const localPath = path.isAbsolute(href) ? href : path.resolve(process.cwd(), href);
          cssText = fs.readFileSync(localPath, 'utf8');
        }
        const parsed = css.parse(cssText || '', { silent: true });
        for (const rule of parsed.stylesheet.rules || []) {
          if (rule.type === 'page') {
            const decls = [];
            (rule.declarations || [])
              .filter((d) => d.type === 'declaration')
              .forEach((d) => {
                const expanded = expandShorthand({ property: d.property, value: d.value, important: !!d.important });
                expanded.forEach((ex) => decls.push(ex));
              });
            decls.forEach((decl) => {
              page[decl.property] = decl.value;
            });
            continue;
          }
          if (rule.type !== 'rule') continue;
          for (const sel of rule.selectors || []) {
            const decls = [];
            (rule.declarations || [])
              .filter((d) => d.type === 'declaration')
              .forEach((d) => {
                const expanded = expandShorthand({ property: d.property, value: d.value, important: !!d.important });
                expanded.forEach((ex) => decls.push(ex));
              });
            rules.push({
              selector: sel,
              specificity: calcSpecificity(sel),
              declarations: decls,
              order: order++,
            });
          }
        }
      } catch {}
    }
  }

  return { rules, page };
}

function isHeadingTag(tagName) {
  return /^h[1-6]$/.test(tagName);
}

const HEADING_SCALE = {
  h1: 2,
  h2: 1.5,
  h3: 1.17,
  h4: 1,
  h5: 0.83,
  h6: 0.75,
};

function hasExplicitFontSize(el, rules) {
  const inline = parseInlineStyle(el.getAttribute && el.getAttribute('style'));
  if (inline.some((decl) => decl.property === 'font-size')) return true;

  return rules.some((rule) => {
    try {
      if (!el.matches || !el.matches(rule.selector)) return false;
    } catch {
      return false;
    }
    return (rule.declarations || []).some((decl) => decl.property === 'font-size');
  });
}

const NON_INHERITED_STYLES = [
  'width',
  'height',
  'padding',
  'margin',
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'box-sizing',

  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'float',
  'clear',
  'overflow',
  'overflow-x',
  'overflow-y',

  'background',
  'background-color',
  'background-image',
  'background-repeat',
  'background-position',
  'background-size',

  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'justify-content',
  'align-items',
  'align-content',
  'order',

  'grid',
  'grid-template-columns',
  'page-break-after',
  'grid-template-rows',
  'grid-template-areas',
  'gap',
  'row-gap',
  'column-gap',

  'opacity',
  'transform',
  'transform-origin',
  'filter',
  'backdrop-filter',
  'transition',
  'animation',

  'border-collapse',
  'table-layout',
  'caption-side',
  'empty-cells',
  'vertical-align',

  'list-style',
  'list-style-type',
  'list-style-position',
  'list-style-image',

  'cursor',
  'pointer-events',
  'white-space',
  'content',
  'outline',
  'clip',
  'clip-path',
];
function getDeclarationBySelector(rules, selector, property) {
  return rules
    .filter((rule) => selector.matches(rule.selector))
    .flatMap((rule) => rule.declarations)
    .find((decl) => decl.property === property)?.value;
}

function computeStylesForElement(el, rules, parentStyles = {}) {
  const styles = {};
  for (const [key, val] of Object.entries(parentStyles)) {
    if (key.startsWith('--')) styles[key] = val;
  }

  const tagName = el.tagName.toLowerCase();
  for (const prop of INHERITABLE) {
    const parentVal = parentStyles[prop];

    const allowInherit =
      parentVal != null && !NON_INHERITED_STYLES.includes(prop) && !(isHeadingTag(tagName) && prop === 'font-size');
    if (getDeclarationBySelector(rules, el, prop) === 'inherit' && parentVal != null) {
      styles[prop] = parentVal;
    } else if (allowInherit) {
      styles[prop] = parentVal;
    }
  }

  const best = {};
  for (const r of rules) {
    try {
      if (!el.matches || !el.matches(r.selector)) continue;
    } catch {
      continue;
    }
    for (const { property, value, important } of r.declarations) {
      if (!property) continue;
      const key = property.toLowerCase();
      const prev = best[key];
      if (!prev) {
        best[key] = { spec: r.specificity, order: r.order, value, important: !!important };
      } else {
        if (!!important !== !!prev.important) {
          if (important) best[key] = { spec: r.specificity, order: r.order, value, important: !!important };
          continue;
        }
        const cmp = compareSpec(prev.spec, r.specificity);
        if (cmp < 0 || (cmp === 0 && prev.order <= r.order)) {
          best[key] = { spec: r.specificity, order: r.order, value, important: !!important };
        }
      }
    }
  }
  for (const [prop, meta] of Object.entries(best)) styles[prop] = meta.value;

  const inline = parseInlineStyle(el.getAttribute && el.getAttribute('style'));
  inline.forEach((decl) => {
    const expanded = expandShorthand(decl);
    expanded.forEach(({ property, value }) => {
      styles[property.toLowerCase()] = value;
    });
  });

  for (const [prop, val] of Object.entries(styles)) {
    if (val !== 'inherit') continue;
    const tagLower = (el.tagName || '').toLowerCase();
    const canInherit =
      (!NON_INHERITED_STYLES.includes(prop) && !(isHeadingTag(tagLower) && prop === 'font-size')) || val === 'inherit';
    if (canInherit && parentStyles[prop] != null) styles[prop] = parentStyles[prop];
    else delete styles[prop];
  }

  const parentFontSize = parsePxWithOptions(parentStyles['font-size'], BASE_PT);
  const baseFontSize = Number.isFinite(parentFontSize) ? parentFontSize : BASE_PT;
  const fontSizeValue =
    styles['font-size'] != null
      ? parsePxWithOptions(styles['font-size'], baseFontSize, { base: baseFontSize, percentBase: baseFontSize })
      : baseFontSize;
  if (isHeadingTag(tagName) && !hasExplicitFontSize(el, rules)) {
    styles['font-size'] = fontSizeValue * (HEADING_SCALE[tagName] || 1);
  } else {
    styles['font-size'] = fontSizeValue;
  }

  for (const [prop, value] of Object.entries(styles)) {
    if (typeof value !== 'string' || !value.includes('var(')) continue;
    styles[prop] = resolveCssVars(value, styles);
  }

  return styles;
}

function resolveCssVars(value, styles, depth = 0) {
  if (depth > 5 || typeof value !== 'string') return value;
  if (!value.includes('var(')) return value;
  return value.replace(/var\((--[^,\s)]+)(?:\s*,\s*([^)]+))?\)/g, (_match, name, fallback) => {
    const raw = styles[name];
    if (raw == null || raw === '') {
      return fallback ? resolveCssVars(fallback.trim(), styles, depth + 1) : '';
    }
    return resolveCssVars(String(raw), styles, depth + 1);
  });
}

function isTextMeaningful(node) {
  if (node.nodeType !== node.TEXT_NODE) return false;
  const parentTag = node.parentNode?.nodeName?.toLowerCase();
  if (parentTag === 'pre' || parentTag === 'code' || parentTag === 'textarea') return true;
  return /\S/.test(node.nodeValue || '');
}

function buildObjectTree(node, rules, parentStyles = {}) {
  if (node.nodeType === node.TEXT_NODE) {
    if (!isTextMeaningful(node)) return null;
    return {
      type: 'text',
      text: node.nodeValue,
    };
  }

  if (node.nodeType === node.ELEMENT_NODE) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return null;
    const attrs = attrsToObject(node.attributes);
    const styles = computeStylesForElement(node, rules, parentStyles);

    const childObjs = [];
    for (const child of node.childNodes) {
      const c = buildObjectTree(child, rules, styles);
      if (c) childObjs.push(c);
    }
    if (childObjs.length) {
      let lastElementIndex = -1;
      childObjs.forEach((child, index) => {
        if (child.type === 'element') lastElementIndex = index;
      });
      childObjs.forEach((child, index) => {
        child._parentTag = tag;
        child._isLastInParent = child.type === 'element' && index === lastElementIndex;
      });
    }

    return {
      type: 'element',
      tag,
      attrs,
      styles,
      children: childObjs,
    };
  }

  return null;
}

async function parseHtmlToObject(
  html,
  {
    fetchExternalCss = true,
    rootSelector = 'body',
    loadTimeoutMs = 3000,
    externalCssTimeoutMs = 5000,
    allowScripts = false,
  } = {}
) {
  const dom = new JSDOM(html, {
    runScripts: allowScripts ? 'dangerously' : undefined,
    resources: fetchExternalCss ? 'usable' : undefined,
    pretendToBeVisual: true,
  });

  if (fetchExternalCss) {
    const loadPromise = new Promise((resolve) => {
      dom.window.addEventListener('load', resolve, { once: true });
      dom.window.addEventListener('error', resolve, { once: true });
    });
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, loadTimeoutMs));
    await Promise.race([loadPromise, timeoutPromise]);
  }

  await new Promise((r) => setTimeout(r, 50));

  const { document } = dom.window;

  const { rules, page } = await collectCssRules(document, {
    fetchExternal: fetchExternalCss,
    externalCssTimeoutMs,
  });

  const root = rootSelector ? document.querySelector(rootSelector) : document.documentElement;
  if (!root) throw new Error(`Root selector "${rootSelector}" not found`);

  const docRoot = document.documentElement;
  const docRootStyles = docRoot ? computeStylesForElement(docRoot, rules, {}) : {};
  const rootStyles = computeStylesForElement(root, rules, docRootStyles);

  const nodes = [];
  for (const child of root.childNodes) {
    const obj = buildObjectTree(child, rules, rootStyles);
    if (obj) nodes.push(obj);
  }
  if (nodes.length) {
    let lastElementIndex = -1;
    nodes.forEach((node, index) => {
      if (node.type === 'element') lastElementIndex = index;
    });
    nodes.forEach((node, index) => {
      node._parentTag = root.tagName?.toLowerCase?.() || 'root';
      node._isLastInParent = node.type === 'element' && index === lastElementIndex;
    });
  }

  return {
    type: 'root',
    tag: root.tagName?.toLowerCase?.() || 'root',
    attrs: attrsToObject(root.attributes || []),
    styles: rootStyles,
    page,
    children: nodes,
  };
}

module.exports = { parseHtmlToObject };
