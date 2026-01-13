export interface FontPaths {
  sansRegular?: string;
  sansBold?: string;
  sansItalic?: string;
  sansBoldItalic?: string;
  serifRegular?: string;
  serifBold?: string;
  serifItalic?: string;
  serifBoldItalic?: string;
}

export interface RenderOptions {
  rootSelector?: string;
  fetchExternalCss?: boolean;
  loadTimeoutMs?: number;
  externalCssTimeoutMs?: number;
  allowScripts?: boolean;
  fonts?: FontPaths;
}

export function renderPdfFromHtml(html: string, options?: RenderOptions): Promise<Buffer>;
declare const _default: {
  renderPdfFromHtml: typeof renderPdfFromHtml;
};
export default _default;
