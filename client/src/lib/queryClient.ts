import { QueryClient } from "@tanstack/react-query";
import { apiJson } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => apiJson("GET", queryKey.join("")),
      retry: 1,
      staleTime: 15_000,
    },
  },
});

export { apiJson, apiRequest } from "./api";
