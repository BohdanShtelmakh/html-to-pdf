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
  outputPath?: string;
  rootSelector?: string;
  fetchExternalCss?: boolean;
  fonts?: FontPaths;
}

export function renderPdfFromHtml(html: string, options?: RenderOptions): Promise<Buffer>;
