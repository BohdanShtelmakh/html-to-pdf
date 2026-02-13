export interface FontFamilyPaths {
  regular?: string;
  bold?: string;
  italic?: string;
  boldItalic?: string;
}

export interface RenderOptions {
  rootSelector?: string;
  fetchExternalCss?: boolean;
  loadTimeoutMs?: number;
  externalCssTimeoutMs?: number;
  allowScripts?: boolean;
  ignoreInvalidImages?: boolean;
  imgLoadTimeoutMs?: number;
  imgLoadTimeout?: number;
  enableInternalAnchors?: boolean;
  autoResolveFonts?: boolean;
  margins?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  svgScale?: number;
  svgDpi?: number;
  fonts?: Record<string, string | FontFamilyPaths>;
}

export function renderPdfFromHtml(html: string, options?: RenderOptions): Promise<Buffer>;
declare const _default: {
  renderPdfFromHtml: typeof renderPdfFromHtml;
};
export default _default;
