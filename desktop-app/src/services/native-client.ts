import { invoke } from '../platform';

/** Tauri 原生命令端口；feature 不应直接拼平台命令参数 */
export const nativeClient = {
  invoke,
  loadProjects: <Project>() => invoke<Project[] | null>('load_projects'),
  saveProjects: <Project>(projects: Project[]) => invoke<string>('save_projects', { projects }),
  loadLibraryBooks: <Book>() => invoke<Book[] | null>('load_library_books'),
  saveLibraryBooks: <Book>(books: Book[]) => invoke<string>('save_library_books', { books }),
  loadRankingBooks: <Book>() => invoke<Book[] | null>('load_ranking_books'),
  saveRankingBooks: <Book>(books: Book[]) => invoke<string>('save_ranking_books', { books }),
  loadDismantleBooks: <Book>() => invoke<Book[] | null>('load_dismantle_books'),
  saveDismantleBooks: <Book>(books: Book[]) => invoke<string>('save_dismantle_books', { books }),
  loadWritingStyles: <Style>() => invoke<Style[] | null>('load_writing_styles'),
  saveWritingStyles: <Style>(styles: Style[]) => invoke<string>('save_writing_styles', { styles }),
};
