import type { ReactNode } from "react";

export type ExternalTypes = {
  children?: ReactNode;
  endpoint: URL;
  lookup: Map<string, number>;
  tags: Set<string>;
};
