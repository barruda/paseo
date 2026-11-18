import { QueryClient } from "@tanstack/react-query";

/** The one query client of the plugin's client bundle. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 2_000 } },
});
