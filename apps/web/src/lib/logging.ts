type ErrorDetails = {
  name: string;
  message: string;
  status?: number;
  path?: string;
};

const toErrorDetails = (error: unknown): ErrorDetails => {
  if (error instanceof Error) {
    const candidate = error as Error & { status?: number; path?: string };
    return {
      name: candidate.name,
      message: candidate.message,
      ...(typeof candidate.status === "number" ? { status: candidate.status } : {}),
      ...(typeof candidate.path === "string" ? { path: candidate.path } : {})
    };
  }

  return {
    name: "UnknownError",
    message: String(error)
  };
};

export const logWebLoadError = (
  scope: string,
  error: unknown,
  context: Record<string, string | number | boolean | null> = {}
): void => {
  console.error(`[web][${scope}]`, {
    ...context,
    ...toErrorDetails(error)
  });
};
