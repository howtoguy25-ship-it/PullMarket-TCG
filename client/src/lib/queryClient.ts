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

export { apiJson, apiRequest } from "./api";
