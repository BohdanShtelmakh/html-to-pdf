const { JSDOM } = require('jsdom');
const { renderPdfFromHtml } = require('../src');

process.once('message', async ({ html, pageSize, orientation }) => {
  try {
    const dom = new JSDOM(html);
    try {
      const document = dom.window.document;
      if (document.querySelectorAll('*').length > 1500) throw new Error('Use at most 1,500 elements');
      if (document.querySelector('script, iframe, object, embed, svg, link, img, video, audio, source')) {
        throw new Error('This demo accepts text and CSS only; scripts, images, SVG and external resources are disabled');
      }
      for (const element of document.querySelectorAll('*')) {
        let depth = 0;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) depth++;
        if (depth > 40) throw new Error('HTML nesting exceeds 40 levels');
        for (const attribute of element.attributes) {
          if (/^on/i.test(attribute.name)) throw new Error('Event handlers are disabled');
        }
      }
    } finally { dom.window.close(); }
  } catch (error) {
    process.send({ error: error.message, status: 422 });
    process.disconnect();
    return;
  }
  try {
    const start = performance.now();
    const pdf = await renderPdfFromHtml(html, {
      pageSize, orientation,
      allowScripts: false, fetchExternalCss: false, autoDownloadEmojiFont: false,
      autoResolveEmojiFont: false, autoResolveFonts: false,
    });
    if (pdf.length > 5 * 1024 * 1024) throw new Error('PDF exceeds 5 MB');
    process.send({ pdf: pdf.toString('base64'), ms: Math.round(performance.now() - start), rssMb: Math.round(process.resourceUsage().maxRSS / 1024) });
  } catch {
    process.send({ error: 'Could not render this HTML', status: 422 });
  } finally { process.disconnect(); }
});
