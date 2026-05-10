const DEFAULT_BASE_URL = "https://api.reloloop.co";

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env;

export const API_BASE_URL = (
  env?.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_BASE_URL
).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  const body = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "message" in body
        ? String((body as { message?: unknown }).message)
        : null) ?? res.statusText;
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
