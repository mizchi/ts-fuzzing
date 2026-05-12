export type Cmd =
  | { kind: "open"; path: string }
  | { kind: "close"; reason: string }
  | { kind: "save"; force: boolean };
