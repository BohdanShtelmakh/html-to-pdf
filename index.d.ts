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
  /**
   * PDFKit size name ("A4", "LETTER", "LEGAL", ...) or [width, height] in points.
   * A height of 'auto' shrinks the last page to its content (max 14400pt tall). Default "A4".
   */
  pageSize?: string | [number, number | 'auto'];
  /** Default "portrait". Not allowed with an 'auto' height. */
  orientation?: 'portrait' | 'landscape';
  svgScale?: number;
  svgDpi?: number;
  /** Path to a color-emoji font (sbix or COLRv0) used to render native color emoji. */
  emojiFont?: string;
  /** Use a known system emoji font (Apple Color Emoji / Segoe UI Emoji) when no emojiFont is given. Default true. */
  autoResolveEmojiFont?: boolean;
  /** Opt-in: download an openly-licensed Twemoji (COLRv0) font when none is available locally. Default false. */
  autoDownloadEmojiFont?: boolean;
  /** Override the cache directory used for the auto-downloaded emoji font. */
  emojiFontCacheDir?: string;
  fonts?: Record<string, string | FontFamilyPaths>;
}

export function renderPdfFromHtml(html: string, options?: RenderOptions): Promise<Buffer>;
declare const _default: {
  renderPdfFromHtml: typeof renderPdfFromHtml;
};
export default _default;
