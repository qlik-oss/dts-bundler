import type { CloseProps } from "./types";
import type { OpenProps } from "./types2";

export interface MenuProps {
  onClose: (props: CloseProps) => void;
  onOpen: (props: OpenProps) => void;
}

declare global {
  interface UIRegistry {
    Menu: MenuProps;
  }
}
