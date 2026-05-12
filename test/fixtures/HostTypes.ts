export type HostShapes = {
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
