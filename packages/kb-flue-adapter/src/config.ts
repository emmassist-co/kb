export interface FlueKbProductConfigLike {
  tenant: {
    id: string;
  };
  knowledgeBase: {
    enabled: boolean;
    mode: string;
    writePolicy: string;
  };
}
