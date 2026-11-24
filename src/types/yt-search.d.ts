declare module 'yt-search' {
  export interface YtsAuthor {
    name: string;
    url?: string;
  }

  export interface YtsVideoResult {
    videoId: string;
    title: string;
    description?: string;
    thumbnail?: string;
    timestamp?: string;
    seconds?: number;
    views?: number;
    ago?: string;
    author?: YtsAuthor;
  }

  export interface YtsSearchResult {
    videos: YtsVideoResult[];
  }

  function yts(query: string): Promise<YtsSearchResult>;
  function yts(options: { videoId: string }): Promise<YtsVideoResult>;
  export default yts;
}
