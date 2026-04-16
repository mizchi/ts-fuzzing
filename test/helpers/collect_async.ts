export const collectAsync = async <Value>(
  iterable: AsyncIterable<Value>,
): Promise<Value[]> => {
  const values: Value[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
};
