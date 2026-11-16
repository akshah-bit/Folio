export type AiPlatform =
  | 'ChatGPT'
  | 'Claude'
  | 'Gemini'
  | 'Perplexity'
  | 'DeepSeek'
  | 'Web'
  | 'Manual';

export type AppTab = 'notes' | 'extension';

export type EditorMode = 'read' | 'split' | 'source';

export interface NoteAsset {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  caption?: string;
  width?: number;
  height?: number;
  sourceUrl?: string;
  createdAt: number;
}

export interface Note {
  id: string;
  title: string;
  notebookId: string;
  sourcePlatform: AiPlatform;
  sourceUrl?: string;
  markdown: string;
  assets: Record<string, NoteAsset>;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
}

export interface Notebook {
  id: string;
  name: string;
  createdAt: number;
}

export interface ClipConversionStats {
  platformDetected: AiPlatform;
  equationsRecovered: number;
  codeBlocksCleaned: number;
  tablesPreserved: number;
  imagesEmbedded: number;
  svgsConverted: number;
}

export interface ClipConversionResult {
  markdown: string;
  assets: Record<string, NoteAsset>;
  suggestedTitle: string;
  stats: ClipConversionStats;
  rawHtmlPreview: string;
}
