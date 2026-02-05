interface QueryOptions {
  enabled?: boolean;
  refetchInterval?: number;
}
interface DataResult {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}
export declare function useData(options: QueryOptions): DataResult;
