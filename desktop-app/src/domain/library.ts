export type DismantleChapterStatus = 'pending' | 'analyzing' | 'analyzed' | 'rewritten';

export interface DismantleChapter {
  id: string;
  number: number;
  title: string;
  sourceContent: string;
  wordCount: number;
  summary: string;
  detailedOutline: string;
  plotBeats: string[];
  characterDynamics: string[];
  setupPayoff: string[];
  pacing: string;
  rewriteContent: string;
  status: DismantleChapterStatus;
  sourcePath?: string;
  outlinePath?: string;
  rewritePath?: string;
  updatedAt: string;
}

export interface DismantleBook {
  id: string;
  title: string;
  sourceFileName: string;
  chapters: DismantleChapter[];
  boundProjectId?: number;
  sourceLibraryBookId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryBookChapter {
  id: string;
  number: number;
  title: string;
  url: string;
  content: string;
  wordCount: number;
  downloaded: boolean;
  unavailableReason?: string;
  outline?: string;
}

export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  source: string;
  sourceId?: string;
  sourceBookId?: string;
  url: string;
  intro: string;
  cover?: string;
  category?: string;
  wordCount?: number;
  chapters: LibraryBookChapter[];
  downloadedAt?: string;
  createdAt: string;
  updatedAt: string;
  localPath?: string;
  fontCss?: string;
}

export type RankingPlatform = 'fanqie' | 'qidian' | 'faloo';
export type RankingType = 'read' | 'new' | 'hot' | 'completed' | 'collect';
export type FanqieSection = 'male-read' | 'male-new' | 'female-read' | 'female-new';

export interface RankingCategoryOption {
  id: string;
  label: string;
  url: string;
  gender: 'male' | 'female';
  list: 'read' | 'new';
}

export interface RankingBook {
  id: string;
  sourceId?: string;
  title: string;
  author: string;
  intro: string;
  cover?: string;
  category?: string;
  rank: number;
  rankType: RankingType;
  gender: 'male' | 'female' | 'all';
  platform: RankingPlatform;
  sourceBookId?: string;
  url: string;
  wordCount?: number;
  readCount?: number;
  fetchedAt: string;
  sourceName?: string;
}

export interface WritingStyle {
  id: string;
  name: string;
  description: string;
  tags: string[];
  content: string;
  sourceBookId?: string;
  createdAt: string;
  updatedAt: string;
  sourcePath?: string;
}
