
const { JSDOM } = require('jsdom');
const axios = require('axios');
const css = require('css');

/** ---------- Utilities ---------- **/

/** Turn DOM NamedNodeMap into plain object */
function attrsToObject(attrs) {
  const out = {};
  if (!attrs) return out;
  for (const a of attrs) out[a.name] = a.value;
  return out;
}

/** Very small specificity calculator: [a(id), b(class|attr|pseudo-class), c(tag|pseudo-element)] */
function calcSpecificity(selector) {
  let a = 0,
    b = 0,
    c = 0;
  const s = selector
    .replace(/:not\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ');

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

/** Compare two specificity tuples [a,b,c]; if equal, later rule wins by source order */
function compareSpec(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  if (a[2] !== b[2]) return a[2] - b[2];
  return 0;
}

/** Parse inline style string -> {prop: value} */
function parseInlineStyle(styleString) {
  const out = {};
  if (!styleString) return out;
  styleString.split(';').forEach((decl) => {
    const [prop, ...rest] = decl.split(':');
    if (!prop || rest.length === 0) return;
    const value = rest.join(':');
    const p = prop.trim().toLowerCase();
    const v = value.trim();
    if (p) out[p] = v;
  });
  return out;
}

/** Basic set of inheritable CSS properties (extend as needed for your PDF renderer) */
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
  'text-align',
  'text-indent',
  'text-transform',
  'white-space',
  'word-spacing',
  'direction',
]);

/** ---------- CSS Collection ---------- **/

/**
 * Collect CSS rules from <style> tags and (optionally) external stylesheets.
 * Returns an array of { selector, specificity, declarations, order }.
 */
async function collectCssRules(doc, { fetchExternal = true } = {}) {
  const rules = [];

  const styleTags = Array.from(doc.querySelectorAll('style'));
  let order = 0;
  for (const tag of styleTags) {
    const parsed = css.parse(tag.textContent || '', { silent: true });
    if (!parsed || !parsed.stylesheet) continue;
    for (const rule of parsed.stylesheet.rules || []) {
      if (rule.type !== 'rule') continue;
      for (const sel of rule.selectors || []) {
        rules.push({
          selector: sel,
          specificity: calcSpecificity(sel),
          declarations: (rule.declarations || [])
            .filter((d) => d.type === 'declaration')
            .map((d) => ({ property: d.property, value: d.value })),
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
        const res = await axios.get(href, { responseType: 'text' });
        const parsed = css.parse(res.data || '', { silent: true });
        for (const rule of parsed.stylesheet.rules || []) {
          if (rule.type !== 'rule') continue;
          for (const sel of rule.selectors || []) {
            rules.push({
              selector: sel,
              specificity: calcSpecificity(sel),
              declarations: (rule.declarations || [])
                .filter((d) => d.type === 'declaration')
                .map((d) => ({ property: d.property, value: d.value })),
              order: order++,
            });
          }
        }
      } catch {
      }
    }
  }

  return rules;
}

/** Merge styles for an element: CSS rules (by specificity & order) + inline style (highest) + inherited */
function computeStylesForElement(el, rules, parentStyles = {}) {
  const styles = {};
  for (const prop of INHERITABLE) {
    if (parentStyles[prop] != null) styles[prop] = parentStyles[prop];
  }

  const best = {};
  for (const r of rules) {
    try {
      if (!el.matches || !el.matches(r.selector)) continue;
    } catch {
      continue;
    }
    for (const { property, value } of r.declarations) {
      if (!property) continue;
      const key = property.toLowerCase();
      const prev = best[key];
      if (!prev) {
        best[key] = { spec: r.specificity, order: r.order, value };
      } else {
        const cmp = compareSpec(prev.spec, r.specificity);
        if (cmp < 0 || (cmp === 0 && prev.order <= r.order)) {
          best[key] = { spec: r.specificity, order: r.order, value };
        }
      }
    }
  }
  for (const [prop, meta] of Object.entries(best)) styles[prop] = meta.value;

  const inline = parseInlineStyle(el.getAttribute && el.getAttribute('style'));
  for (const [k, v] of Object.entries(inline)) styles[k.toLowerCase()] = v;

  return styles;
}

/** ---------- Tree Builder ---------- **/

function isTextMeaningful(node) {
  if (node.nodeType !== node.TEXT_NODE) return false;
  const parentTag = node.parentNode?.nodeName?.toLowerCase();
  if (parentTag === 'pre' || parentTag === 'code' || parentTag === 'textarea') return true;
  return /\S/.test(node.nodeValue || '');
}

/** Convert DOM Node -> plain object tree */
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
    const attrs = attrsToObject(node.attributes);
    const styles = computeStylesForElement(node, rules, parentStyles);

    const childObjs = [];
    for (const child of node.childNodes) {
      const c = buildObjectTree(child, rules, styles);
      if (c) childObjs.push(c);
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

/** ---------- Public API ---------- **/

/**
 * Parse HTML -> object tree with merged styles.
 * @param {string} html - the HTML string
 * @param {object} opts
 *   - fetchExternalCss: boolean (default true) to load <link rel="stylesheet"> via HTTP
 *   - rootSelector: string | null — if provided, start from this element (e.g., 'body' or '#app')
 */
async function parseHtmlToObject(html, { fetchExternalCss = true, rootSelector = 'body' } = {}) {
  const dom = new JSDOM(html);
  const { document } = dom.window;

  const rules = await collectCssRules(document, { fetchExternal: fetchExternalCss });

  const root = rootSelector ? document.querySelector(rootSelector) : document.documentElement;
  if (!root) throw new Error(`Root selector "${rootSelector}" not found`);

  const nodes = [];
  for (const child of root.childNodes) {
    const obj = buildObjectTree(child, rules, {});
    if (obj) nodes.push(obj);
  }

  return {
    type: 'root',
    tag: root.tagName?.toLowerCase?.() || 'root',
    attrs: attrsToObject(root.attributes || []),
    styles: {},
    children: nodes,
  };
}

module.exports = { parseHtmlToObject };
