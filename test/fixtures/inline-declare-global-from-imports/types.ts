declare global {
  interface PrivateQlikEmbedProps {
    /** Typically not used */
    allowPrivateUnsupportedInternalQlikUIs?: boolean;
    /** Typically not used */
    close?: (closeProps: unknown) => unknown;
    /** If embedding is running in an iframe */
    qmfeEmbedIframed?: boolean;
    onLoading?: () => void;
    /**
     * Called when the parcel reports readiness via `reportReady()`, or immediately after mount
     * if `reportsReadiness` is not set.
     * Indicates the parcel is ready to be shown to users to reduce flickering on load.
     *
     * @example
     * ```ts
     * // Parcel definition
     * export const Chart = qmfeReactParcel({
     *   lazyComponent: () => import("./parcels/Chart"),
     *   reportsReadiness: true,
     * });
     *
     * // Inside the parcel component
     * export default function Chart(props: QmfeParcelProps<"charts/Chart">) {
     *   const { reportReady } = props;
     *   const { data } = useQuery({ queryKey: ["chart-data"], queryFn: fetchChartData });
     *
     *   useLayoutEffect(() => {
     *     if (data) {
     *       reportReady();
     *     }
     *   }, [data, reportReady]);
     *
     *   return <div>Chart UI</div>;
     * }
     * ```
     */
    onReady?: () => void;
    /**
     * Called when the parcel reports steadiness via `reportSteady()`, or immediately after mount
     * if `reportsSteadiness` is not set.
     * Indicates everything inside the parcel has finished loading, animations have completed, and the DOM is steady.
     *
     * @example
     * ```ts
     * // Parcel definition
     * export const Chart = qmfeReactParcel({
     *   lazyComponent: () => import("./parcels/Chart"),
     *   reportsSteadiness: true,
     * });
     *
     * // Inside the parcel component
     * export default function Chart(props: QmfeParcelProps<"charts/Chart">) {
     *   const { reportSteady } = props;
     *   const [animationComplete, setAnimationComplete] = useState(false);
     *
     *   useLayoutEffect(() => {
     *     // Wait for animations to complete or other components to finish loading their data
     *     if (animationComplete) {
     *       reportSteady();
     *     }
     *   }, [animationComplete, reportSteady]);
     *
     *   return <div>Chart UI</div>;
     * }
     * ```
     */
    onSteady?: () => void;
    /**
     * @experimental
     */
    updateWrapperProps?: (props: Record<string, unknown>) => void;
  }
}

export type CloseProps = {
  reason: "escape" | "backdrop";
};
