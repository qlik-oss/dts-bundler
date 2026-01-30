import type { CloseProps } from "./types";

export interface MenuProps {
  onClose: (props: CloseProps) => void;
}

declare global {
  interface UIRegistry {
    Menu: MenuProps;
  }
}
