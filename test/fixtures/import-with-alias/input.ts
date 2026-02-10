import type { AliasedType } from "~/Aliased";

export type { ExportedType } from "~/Exported";

export type CustomContentParcel = {
  parcelName: string;
  parcelProps?: Record<string, any>;
};

declare global {
  interface QlikEmbedUIs {
    "assistant-ui/CreateKnowledgeBase": object;
    "assistant-ui/CreateAssistant": object;
    "automation-connections/AddConnectionModal": object;
    "platform-ui/Loader": {
      props: {
        text?: string;
        animation?: boolean;
        fullscreen?: boolean;
        cover?: boolean;
        aliased: AliasedType;
      };
    };
  }
}
