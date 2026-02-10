export interface QueryOptions {
  enabled?: boolean;
  refetchInterval?: number;
}

export interface DataResult {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}
