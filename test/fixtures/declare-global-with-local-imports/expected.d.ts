type CloseProps = {
  reason: "escape" | "backdrop";
};
export interface MenuProps {
  onClose: (props: CloseProps) => void;
}
declare global {
  interface UIRegistry {
    Menu: MenuProps;
  }
}
