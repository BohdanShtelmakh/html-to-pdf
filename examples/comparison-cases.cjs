const fs = require('fs');
const path = require('path');

const registerRows = [
  Array.from({ length: 19 }, (_, i) => i + 1),
  Array.from({ length: 21 }, (_, i) => i + 20),
  Array.from({ length: 10 }, (_, i) => i + 41),
];

function documentHtml(content) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size:A4; margin:32px; }
    body { margin:0; padding:12px; font-family:Helvetica,Arial,sans-serif; font-size:13px; }
    p { margin:0 0 16px; line-height:1.5; }
    table { width:100%; border-collapse:collapse; }
    td,th { border:1px solid #777; padding:8px; }
  </style></head><body>${content}</body></html>`;
}

function loadComparisonCases() {
  const examples = ['invoice', 'report', 'long-table'].map(name => ({
    name, html: fs.readFileSync(path.join(__dirname, `${name}.html`), 'utf8'),
    expectedPages: name === 'long-table' ? 3 : 1,
    markers: name === 'invoice' ? ['INVOICE INV-0042', 'Total due: $990.00', 'Payment terms']
      : name === 'report' ? ['Quarterly Report', 'Renewals remained strong.', 'Next Quarter', 'Review note:']
        : [...Array.from({ length: 50 }, (_, i) => `Customer ${String(i + 1).padStart(3, '0')}`), 'End of register: all 50 accounts listed.'],
    ...(name === 'long-table' ? { expectedRowsByPage: registerRows, pageMarkers: [['Status and notes'], ['Status and notes'], ['Status and notes']] } : {}),
  }));
  const longWord = 'LongWordABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return [...examples,
    { name: 'fonts', expectedPages: 1, markers: ['SansRegular', 'SansBold', 'SansItalic', 'SerifRegular', 'SerifBold'],
      html: documentHtml(`<div style="width:220px"><p>SansRegular: wrapped text with ordinary spaces.</p>
        <p><strong>SansBold: bold wrapped text with ordinary spaces.</strong></p>
        <p><em>SansItalic: italic wrapped text with ordinary spaces.</em></p>
        <p style="font-family:Times New Roman,serif">SerifRegular: wrapped text with ordinary spaces.</p>
        <p style="font-family:Times New Roman,serif"><strong>SerifBold: bold wrapped text with ordinary spaces.</strong></p></div>`) },
    { name: 'long-words', expectedPages: 1, markers: [longWord, 'AfterLongWord', 'AfterNoWrap'],
      html: documentHtml(`<div style="width:110px;border:1px solid #777;padding:8px">
        <p style="word-break:break-word"><strong>${longWord}</strong></p><p>AfterLongWord</p></div>
        <p style="white-space:nowrap">No wrap value 1234567890</p><p>AfterNoWrap</p>`) },
    { name: 'mixed-style', expectedPages: 1, markers: ['MixedStart', 'MixedEnd', 'AfterMixed', 'ExplicitBreak'],
      html: documentHtml(`<div style="width:180px;border:1px solid #777;padding:12px">
        <p><strong>MixedStart bold words</strong> followed by <em>italic words</em> and ordinary wrapping text.
        <span style="font-size:16px">Larger words</span> finish at MixedEnd.</p>
        <p><strong>AfterMixed</strong><br>ExplicitBreak</p></div>`) },
    { name: 'nested-tables', expectedPages: 1, markers: ['NorthRegion', 'SouthRegion', 'ARRnorth', '$1.1M', 'NPSnorth', '71', 'ARRsouth', '$720K', 'NPSsouth', '68', 'AfterNested'],
      html: documentHtml(`<table><tr><td>NorthRegion<table><tr><td>ARRnorth</td><td>$1.1M</td></tr>
        <tr><td>NPSnorth</td><td>71</td></tr></table></td><td>SouthRegion<table><tr><td>ARRsouth</td><td>$720K</td></tr>
        <tr><td>NPSsouth</td><td>68</td></tr></table></td></tr></table><p>AfterNested</p>`) },
    { name: 'page-breaks', expectedPages: 2, markers: ['BeforeForcedBreak', 'AfterForcedBreak', 'FinalBlock'],
      pageMarkers: [['BeforeForcedBreak'], ['AfterForcedBreak', 'FinalBlock']],
      html: documentHtml(`<p>BeforeForcedBreak</p><div style="page-break-before:always">
        <p>AfterForcedBreak</p><div style="break-inside:avoid;border:1px solid #777;padding:12px">
        <p>FinalBlock</p><p>These two lines stay inside the final framed block.</p></div></div>`) },
  ];
}

function loadStressCases() {
  const markers = Array.from({ length: 70 }, (_, i) => `StressLine${String(i + 1).padStart(3, '0')}`);
  const lines = markers.map(marker => `<p>${marker}</p>`).join('');
  return [
    { name: 'stress-framed-block', expectedPages: 3, markers: [...markers, 'AfterStress'], html: documentHtml(`<div style="border:1px solid #777;padding:12px">${lines}</div><p>AfterStress</p>`) },
    { name: 'stress-tall-row', expectedPages: 2, markers: [...markers, 'Companion', 'AfterStress'], pageMarkers: [['Companion']], html: documentHtml(`<table><tr><td>${markers.join('<br>')}</td><td>Companion</td></tr></table><p>AfterStress</p>`) },
    { name: 'stress-nested-pagination', expectedPages: 3, markers: [...markers, 'OuterLabel', 'AfterStress'], pageMarkers: [['OuterLabel']], html: documentHtml(`<table><tr><td>OuterLabel<table>${markers.map(marker => `<tr><td>${marker}</td><td>Value</td></tr>`).join('')}</table></td></tr></table><p>AfterStress</p>`) },
  ];
}

module.exports = { loadComparisonCases, loadStressCases };
