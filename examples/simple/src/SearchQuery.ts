import type {
  Int,
  Max,
  MaxLength,
  Min,
  MinLength,
  Pattern,
} from "ts-fuzzing";

export type SearchQuery = {
  contact?: string & Pattern<"email">;
  page: number & Int & Min<1> & Max<5>;
  sort?: "recent" | "relevance";
  term: string & MinLength<1> & MaxLength<12>;
};

export const normalizeQuery = (query: SearchQuery) => {
  return {
    ...query,
    term: query.term.trim().toLowerCase(),
  };
};

export const buildSearchPath = (query: SearchQuery) => {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("term", query.term);
  if (query.sort) {
    params.set("sort", query.sort);
  }
  if (query.contact) {
    params.set("contact", query.contact);
  }
  return `/search?${params.toString()}`;
};
