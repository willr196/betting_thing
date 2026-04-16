type NormalizeEnvValueOptions = {
  emptyStringAsUndefined?: boolean;
};

type NormalizeProcessEnvOptions = {
  preserveEmptyKeys?: string[];
};

export const normalizeEnvValue = (
  value: unknown,
  options: NormalizeEnvValueOptions = {}
): unknown => {
  const emptyStringAsUndefined = options.emptyStringAsUndefined ?? true;

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  let normalized = trimmed;

  if (trimmed.length >= 2) {
    const hasDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
    const hasSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'");

    if (hasDoubleQuotes || hasSingleQuotes) {
      normalized = trimmed.slice(1, -1).trim();
    }
  }

  if (emptyStringAsUndefined && normalized === '') {
    return undefined;
  }

  return normalized;
};

export const normalizeProcessEnv = (
  env: NodeJS.ProcessEnv,
  options: NormalizeProcessEnvOptions = {}
): Record<string, unknown> => {
  const preserveEmptyKeys = new Set(options.preserveEmptyKeys ?? []);

  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      normalizeEnvValue(value, {
        emptyStringAsUndefined: !preserveEmptyKeys.has(key),
      }),
    ])
  );
};

export const normalizeUrlOrigin = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
};
