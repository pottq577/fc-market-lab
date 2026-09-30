const NEXON_OPEN_API_KEY_HEADER = "x-nxopen-api-key";

export function normalizeNexonOpenApiKey(value: string | undefined): string {
  const apiKey = value?.trim() ?? "";
  if (apiKey === "") {
    throw new TypeError("NEXON_OPEN_API_KEY environment variable is required");
  }

  try {
    new Headers({ [NEXON_OPEN_API_KEY_HEADER]: apiKey });
  } catch (error) {
    throw new TypeError(
      "NEXON_OPEN_API_KEY must be a valid HTTP header value; check .env for placeholder text or non-ASCII characters",
      { cause: error },
    );
  }

  return apiKey;
}
