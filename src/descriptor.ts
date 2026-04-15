export type FuzzConstraints = {
  min?: number;
  max?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type UnknownDescriptor = {
  kind: "unknown";
};

export type StringDescriptor = {
  kind: "string";
  constraints?: FuzzConstraints;
};

export type NumberDescriptor = {
  kind: "number";
  integer: boolean;
  constraints?: FuzzConstraints;
};

export type BooleanDescriptor = {
  kind: "boolean";
};

export type LiteralDescriptor = {
  kind: "literal";
  value: string | number | boolean | null;
};

export type NullDescriptor = {
  kind: "null";
};

export type UndefinedDescriptor = {
  kind: "undefined";
};

export type FunctionDescriptor = {
  kind: "function";
};

export type ReactNodeDescriptor = {
  kind: "react-node";
};

export type UrlDescriptor = {
  kind: "url";
};

export type MapDescriptor = {
  kind: "map";
  key: TypeDescriptor;
  value: TypeDescriptor;
};

export type SetDescriptor = {
  kind: "set";
  item: TypeDescriptor;
};

export type ArrayDescriptor = {
  kind: "array";
  item: TypeDescriptor;
  constraints?: FuzzConstraints;
};

export type TupleDescriptor = {
  kind: "tuple";
  items: TypeDescriptor[];
};

export type PropertyDescriptor = {
  key: string;
  optional: boolean;
  value: TypeDescriptor;
};

export type ObjectDescriptor = {
  kind: "object";
  properties: PropertyDescriptor[];
};

export type UnionDescriptor = {
  kind: "union";
  options: TypeDescriptor[];
};

export type TypeDescriptor =
  | ArrayDescriptor
  | BooleanDescriptor
  | FunctionDescriptor
  | LiteralDescriptor
  | NullDescriptor
  | NumberDescriptor
  | ObjectDescriptor
  | MapDescriptor
  | ReactNodeDescriptor
  | SetDescriptor
  | StringDescriptor
  | TupleDescriptor
  | UndefinedDescriptor
  | UnionDescriptor
  | UrlDescriptor
  | UnknownDescriptor;
