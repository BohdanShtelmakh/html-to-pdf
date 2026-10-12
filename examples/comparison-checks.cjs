function rowsByPage(text, pages) {
  const pageText = text.split('\f');
  return Array.from({ length: pages }, (_, index) =>
    [...(pageText[index] || '').matchAll(/Customer\s+(\d{3})/g)].map(match => Number(match[1])));
}

function validateResult(spec, { text, pages }) {
  const issues = [];
  const compact = text.replace(/\s+/g, '');
  if (pages !== spec.expectedPages) issues.push(`Expected ${spec.expectedPages} pages, received ${pages}`);
  for (const marker of spec.markers) {
    const count = compact.split(marker.replace(/\s+/g, '')).length - 1;
    if (count !== 1) issues.push(`Expected one occurrence of ${marker}, received ${count}`);
  }
  if (spec.expectedRowsByPage && JSON.stringify(rowsByPage(text, pages)) !== JSON.stringify(spec.expectedRowsByPage)) {
    issues.push('Row order or page distribution differs from the reviewed register fixture');
  }
  const pageText = text.split('\f');
  for (const [index, markers] of (spec.pageMarkers || []).entries()) {
    const content = (pageText[index] || '').replace(/\s+/g, '');
    for (const marker of markers) {
      if (!content.includes(marker.replace(/\s+/g, ''))) issues.push(`Missing ${marker} on page ${index + 1}`);
    }
  }
  return issues;
}

module.exports = { rowsByPage, validateResult };
