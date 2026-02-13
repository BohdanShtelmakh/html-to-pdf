function normalizeHref(run) {
  const raw = run?.href;
  if (!raw) return null;
  const href = String(raw).trim();
  return href || null;
}

function isExternalHref(href) {
  return /^(https?:|mailto:|tel:)/i.test(href);
}

function getRunLinkTextOptions(run, { enableInternalAnchors = true } = {}) {
  const href = normalizeHref(run);
  if (!href) return {};
  if (isExternalHref(href)) return { link: href };
  if (enableInternalAnchors === false) return {};
  if (!href.startsWith('#')) return {};
  const target = run?.anchorTarget || href.slice(1);
  if (!target) return {};
  return { goTo: target };
}

module.exports = { getRunLinkTextOptions };
