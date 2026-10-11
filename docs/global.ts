declare global {
  // Global variable with Figma's plugin API.
  const figma: PluginAPI
  const __html__: string
  const __uiFiles__: {
    [key: string]: string
  }

  const console: Console

  // The plugin environment exposes the browser console API, so expected calls
  // like console.log() still work.
  interface Console {
    log(message?: any, ...optionalParams: any[]): void
    error(message?: any, ...optionalParams: any[]): void
    assert(condition?: boolean, message?: string, ...data: any[]): void
    info(message?: any, ...optionalParams: any[]): void
    warn(message?: any, ...optionalParams: any[]): void
    clear(): void
  }
  function setTimeout(callback: Function, timeout: number): number
  function clearTimeout(handle: number): void
  function setInterval(callback: Function, timeout: number): number
  function clearInterval(handle: number): void

  /**
   * Fetch a resource from the network, and return a promise with the response.
   *
   * @param url - The URL of the requested resource. Unlike standardized `fetch`, this must be a `string`.
   * @param init - An optional argument with the following optional parameters:
   *
   * ```ts
   * interface FetchOptions {
   *   method?: string
   *   headers?: {[name: string]: string}
   *   body?: Uint8Array | string
   *   credentials?: string
   *   cache?: string
   *   redirect?: string
   *   referrer?: string
   *   integrity?: string
   * }
   * ```
   *
   * - `method`: The request method, e.g. `GET`, `POST`, etc.
   * - `headers`: The headers to add to the request. Note that unlike the standardized `fetch`, this can only be a plain javascript object.
   * - `body`: The body to add to this request, if any. This can be either a string or a Uint8Array.
   * - `cache`: The cache mode to use for this request. See https://developer.mozilla.org/en-US/docs/Web/API/Request/cache for available values.
   * - `redirect`: The redirect mode to use for this request: `follow` or `error`.
   * - `referrer`: The referrer for this request.
   * - `integrity`: The subresource integrity value of the request. See https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity for more information.
   *
   * Calling fetch returns a `FetchResponse` object:
   *
   * ```ts
   * interface FetchResponse {
   *   headersObject: {[name: string]: string}
   *   ok: boolean
   *   redirected: boolean
   *   status: number
   *   statusText: string
   *   type: string
   *   url: string
   *   arrayBuffer(): Promise<ArrayBuffer>
   *   text(): Promise<string>
   *   json(): Promise<any>
   * }
   * ```
   *
   * - `headersObject`: The headers associated with the response. Note that unlike the standardized `fetch`, this is a plain object.
   * - `ok`: Whether the result was successful.
   * - `redirected`: Whether the response is the result of a redirect.
   * - `status`: The status code of the response.
   * - `statusText`: The status text corresponding to this status code.
   * - `type`: The type of response.
   * - `url`: The URL of the response.
   * - `arrayBuffer()`: Returns a promise with the contents of the response body as a `ArrayBuffer`.
   * - `text()`: Returns a promise with the contents of the response body as a string, decoded as `utf-8`.
   * - `json()`: Returns a promise with the contents of the response body as Javascript object.
   *
   * @remarks This function has similar behavior to the standardized `fetch()` function, with some minor differences. See the {@link FetchOptions} and {@link FetchResponse} interfaces for more information.
   *
   */
  function fetch(url: string, init?: FetchOptions): Promise<FetchResponse>

  /**
   * @pageId properties/global-fetch
   */
  interface FetchOptions {
    method?: string
    headers?: { [name: string]: string }
    headersObject?: { [name: string]: string }
    body?: Uint8Array | string
    credentials?: string
    cache?: string
    redirect?: string
    referrer?: string
    integrity?: string
  }

  /**
   * @pageId properties/global-fetch
   */
  interface FetchResponse {
    headersObject: { [name: string]: string }
    ok: boolean
    redirected: boolean
    status: number
    statusText: string
    type: string
    url: string
    arrayBuffer(): Promise<ArrayBuffer>
    text(): Promise<string>
    json(): Promise<any>
  }
} // declare global

export {}
