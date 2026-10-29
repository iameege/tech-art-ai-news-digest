import type { RawArticle } from "../sources/types";

export interface ArticleInput extends RawArticle {
  source: string;
}
