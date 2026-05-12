import { describe, expect, test } from "vitest";
import { analyzeTypeDescriptor, fuzzValues } from "../src/index.js";

const sourcePath = new URL("./fixtures/HostTypes.ts", import.meta.url);

describe("DOM / Web API host type normalization", () => {
  test("analyzer maps host types to dedicated descriptors", () => {
    const descriptor = analyzeTypeDescriptor({
      sourcePath: new URL("./fixtures/HostTypes.ts", import.meta.url).pathname,
      typeName: "HostShapes",
    });

    expect(descriptor.kind).toBe("object");
    if (descriptor.kind !== "object") return;

    const properties = Object.fromEntries(
      descriptor.properties.map((property) => [property.key, property.value]),
    );
    expect(properties.payload).toEqual({ kind: "host", host: "blob" });
    expect(properties.attachment).toEqual({ kind: "host", host: "file" });
    expect(properties.form).toEqual({ kind: "host", host: "form-data" });
    expect(properties.headers).toEqual({ kind: "host", host: "headers" });
    expect(properties.params).toEqual({ kind: "host", host: "url-search-params" });
    expect(properties.signal).toEqual({ kind: "host", host: "abort-signal" });
    expect(properties.event).toEqual({ kind: "host", host: "event" });
    expect(properties.request).toEqual({ kind: "host", host: "request" });
    expect(properties.response).toEqual({ kind: "host", host: "response" });
  });

  test("fuzzValues produces actual host instances", async () => {
    type Input = {
      payload: Blob;
      attachment: File;
      form: FormData;
      headers: Headers;
      params: URLSearchParams;
      signal: AbortSignal;
      event: Event;
      request: Request;
      response: Response;
    };

    const checked = {
      blob: 0,
      file: 0,
      form: 0,
      headers: 0,
      params: 0,
      signal: 0,
      event: 0,
      request: 0,
      response: 0,
    };

    await fuzzValues<Input>({
      sourcePath,
      typeName: "HostShapes",
      numRuns: 16,
      seed: 1,
      run({ payload, attachment, form, headers, params, signal, event, request, response }) {
        if (payload instanceof Blob) checked.blob += 1;
        if (attachment instanceof File) checked.file += 1;
        if (form instanceof FormData) checked.form += 1;
        if (headers instanceof Headers) checked.headers += 1;
        if (params instanceof URLSearchParams) checked.params += 1;
        if (signal instanceof AbortSignal) checked.signal += 1;
        if (event instanceof Event) checked.event += 1;
        if (request instanceof Request) checked.request += 1;
        if (response instanceof Response) checked.response += 1;
      },
    });

    for (const [name, count] of Object.entries(checked)) {
      expect(count, `expected at least one ${name} instance`).toBeGreaterThan(0);
    }
  });
});
