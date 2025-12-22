type Truthy<T> = T extends false | "" | 0 | null | undefined ? never : T;

export function truthy<T>(value: T): value is Truthy<T> {
  return Boolean(value);
}

export function safeURL(input: string): URL | undefined {
  try {
    return new URL(input);
  } catch {
    return undefined;
  }
}
