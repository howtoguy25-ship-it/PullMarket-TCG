import { QueryClient } from "@tanstack/react-query";
import { apiJson } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // meta.silent401 lets a background/polling query (see api.ts's
      // ApiRequestOptions) opt out of the global sign-out a 401 normally
      // triggers — set it via `useQuery({ ..., meta: { silent401: true } })`.
      queryFn: async ({ queryKey, meta }) => apiJson("GET", queryKey.join(""), undefined, { silent401: meta?.silent401 === true }),
      retry: 1,
      staleTime: 15_000,
    },
  },
});

// Every query key in this app is the exact request URL (see queryFn above),
// including whatever search/franchise/condition params are on it right now
// — so the home feed's active key is a string like
// "/api/listings?franchise=pokemon", never the bare "/api/listings".
// invalidateQueries({ queryKey: ["/api/listings"] }) only matches by exact
// prefix equality per array element, and a string is never a "prefix" of a
// longer string that way — so that call silently invalidates nothing
// whenever any filter/search is active, and a freshly created or edited
// listing never appears until the app is fully restarted. This predicate
// does the real prefix match instead, catching every "/api/listings..."
// variant (feed, /mine, /:id) regardless of query string.
export function invalidateListingsQueries(client: QueryClient = queryClient) {
  return client.invalidateQueries({
    predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/listings"),
  });
}

export { apiJson, apiRequest } from "./api";
