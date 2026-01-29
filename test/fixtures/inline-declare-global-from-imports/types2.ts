declare global {
  interface QlikEmbedUIs {
    "ui-kit/ConfirmDialog": {
      props: {
        type: "confirm" | "delete";
        actionText: string;
        /** defaults to a localized 'Cancel' */
        cancelText?: string;
        content: string;
        doNotShowAgainKey?: string;
        onConfirm?: () => Promise<void>;
        onCancel: () => void;
      };
    };
    "ui-kit/ModalWrapper": {
      props: {
        /** parcel to show in the modal container */
        content?: string;
        /** adds a modal title to the top of the modal element */
        title?: string;
        /** adds a description below the title */
        description?: string;

        /**
         * Minimum height of the modal container. Once the parcel gets rendered it will fit the size of that content.
         * Can be used to reduce layout shifting since the height of the modal is not know until the parcel is rendered.
         */
        height?: string;
        /**
         * Disable padding on the modal content. This is useful for when the parcel has its own padding and
         * you want to avoid double padding.
         * @experimental
         */
        noPadding?: boolean;
      };
    };
    "ui-kit/Menu": {
      props: OpenProps;
    };
    "ui-kit/PopoverWrapper": {
      props: {
        /** The element to anchor the popover to */
        anchorEl?: HTMLElement;
        /** The position of the popover */
        anchorPosition?: {
          top: number;
          left: number;
        };
        /** The popover content */
        content?: string;
      };
    };
  }
}

export type OpenProps = {
  reason: "inTab" | "newWindow" | "modal";
};
