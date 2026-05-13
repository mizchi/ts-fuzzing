import fc from "fast-check";
import type { HostType } from "./descriptor.js";

const smallString = () => fc.string({ maxLength: 16 });

const blobArbitrary = (): fc.Arbitrary<Blob> =>
  fc
    .tuple(smallString(), fc.constantFrom("text/plain", "application/json", "application/octet-stream"))
    .map(([content, type]) => new Blob([content], { type }));

const fileArbitrary = (): fc.Arbitrary<File> =>
  fc
    .tuple(smallString(), smallString(), fc.constantFrom("text/plain", "application/octet-stream"))
    .map(([content, name, type]) => new File([content], name || "file.bin", { type }));

const formDataArbitrary = (): fc.Arbitrary<FormData> =>
  fc.array(fc.tuple(smallString(), smallString()), { maxLength: 4 }).map((entries) => {
    const form = new FormData();
    for (const [key, value] of entries) {
      if (key.length === 0) continue;
      form.append(key, value);
    }
    return form;
  });

const headersArbitrary = (): fc.Arbitrary<Headers> =>
  fc.array(fc.tuple(smallString(), smallString()), { maxLength: 4 }).map((entries) => {
    const headers = new Headers();
    for (const [key, value] of entries) {
      const safeKey = key.replace(/[^a-zA-Z0-9-]/g, "");
      if (safeKey.length === 0) continue;
      try {
        headers.append(safeKey, value.replace(/[\r\n]/g, ""));
      } catch {
        /* swallow invalid header errors */
      }
    }
    return headers;
  });

const urlSearchParamsArbitrary = (): fc.Arbitrary<URLSearchParams> =>
  fc.array(fc.tuple(smallString(), smallString()), { maxLength: 4 }).map((entries) => {
    const params = new URLSearchParams();
    for (const [key, value] of entries) {
      if (key.length === 0) continue;
      params.append(key, value);
    }
    return params;
  });

const abortSignalArbitrary = (): fc.Arbitrary<AbortSignal> =>
  fc.boolean().map((aborted) => {
    if (aborted) {
      return AbortSignal.abort();
    }
    const controller = new AbortController();
    return controller.signal;
  });

const requestArbitrary = (): fc.Arbitrary<Request> =>
  fc
    .tuple(
      fc.webUrl(),
      fc.constantFrom("GET", "POST", "PUT", "DELETE", "PATCH"),
    )
    .map(([url, method]) => {
      const init: RequestInit = { method };
      if (method !== "GET") {
        init.body = "fuzz-body";
      }
      return new Request(url, init);
    });

const responseArbitrary = (): fc.Arbitrary<Response> =>
  fc
    .tuple(
      smallString(),
      fc.constantFrom(200, 201, 204, 301, 400, 404, 500),
    )
    .map(([body, status]) => new Response(status === 204 || status === 301 ? null : body, { status }));

const eventArbitrary = (): fc.Arbitrary<Event> =>
  fc
    .constantFrom("click", "load", "error", "message", "custom")
    .map((type) => new Event(type));

export const hostArbitrary = (host: HostType): fc.Arbitrary<unknown> => {
  switch (host) {
    case "blob":
      return blobArbitrary();
    case "file":
      return fileArbitrary();
    case "form-data":
      return formDataArbitrary();
    case "headers":
      return headersArbitrary();
    case "url-search-params":
      return urlSearchParamsArbitrary();
    case "abort-signal":
      return abortSignalArbitrary();
    case "request":
      return requestArbitrary();
    case "response":
      return responseArbitrary();
    case "event":
      return eventArbitrary();
    default: {
      const _exhaustive: never = host;
      return _exhaustive;
    }
  }
};

export const hostBoundaryValues = (host: HostType): unknown[] => {
  switch (host) {
    case "blob":
      return [new Blob([]), new Blob(["hello"], { type: "text/plain" })];
    case "file":
      return [new File([], "empty.txt"), new File(["hello"], "hello.txt", { type: "text/plain" })];
    case "form-data":
      return [new FormData()];
    case "headers":
      return [new Headers(), new Headers({ "content-type": "application/json" })];
    case "url-search-params":
      return [new URLSearchParams(), new URLSearchParams("a=1&b=2")];
    case "abort-signal":
      return [new AbortController().signal, AbortSignal.abort()];
    case "request":
      return [new Request("https://example.com/")];
    case "response":
      return [new Response(null, { status: 204 }), new Response("ok")];
    case "event":
      return [new Event("click"), new Event("error")];
    default: {
      const _exhaustive: never = host;
      return _exhaustive;
    }
  }
};
