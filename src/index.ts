import * as http from 'http';
import { Socket } from 'net';

import { bodyReader, Resolvable } from './utils';

export interface MockHttpServerOptions {
  port: number;
  timeout: number;
}

export interface MockHttpServer {
  readonly port: number;
  readonly host: string;
  waitForRequest(path: string): Promise<RequestMapEntry>;
}

function generatePort(): number {
  return Math.floor(4000 + Math.random() * 4000);
}

export type RequestHandler = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  error?: Error
) => void;

interface RequestMapEntry {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  body(encoding: BufferEncoding): Promise<string>;
  body(): Promise<Buffer>;
}

class MockHttpServerImpl implements MockHttpServer {
  private _server?: http.Server;
  private _promiseStart?: Resolvable<this>;
  private _requestHandlers: { path: string; handler: RequestHandler }[] = [];
  private _activeResponses: http.ServerResponse[] = [];
  private _running = false;
  private _connections: Socket[] = [];

  constructor(private readonly _options: MockHttpServerOptions) {}

  get port(): number {
    return this._options.port;
  }

  get host(): string {
    return `http://localhost:${this.port}`;
  }

  clear() {
    this._requestHandlers = [];
    this._activeResponses = [];

    for (const conn of this._connections) {
      conn.unref();
      conn.destroy();
    }

    this._connections = [];
  }

  start(): Promise<this> {
    if (this._running) {
      return this._promiseStart?.promise ?? Promise.reject('Unexpected state');
    }

    this._running = true;
    this._promiseStart = new Resolvable<this>();

    this._server = http.createServer((request, response) => {
      const path = `/${String(request.url).split(/\//)[1] ?? ''}`;
      const handlers = this._requestHandlers.filter(h => h.path === path);

      // Всегда и сразу разрешаем CORS
      response.setHeader(
        'access-control-allow-origin',
        request.headers.origin ?? '*'
      );

      for (const handler of handlers) {
        handler.handler(request, response);
      }

      this._activeResponses.push(response);
    });

    this._server.listen(this._options.port, () => {
      this._promiseStart?.resolve(this);
    });

    this._server.on('connection', conn => {
      this._connections.push(conn);

      conn.on('close', () => {
        this._connections = this._connections.filter(c => c !== conn);
      });
    });

    return this._promiseStart.promise;
  }

  stop(): Promise<void> {
    this._running = false;

    return new Promise((resolve, reject) => {
      this.clear();
      this._server?.unref();

      this._server?.close((error?) => {
        this._server = undefined;

        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  waitForRequest(path: string): Promise<RequestMapEntry> {
    const resolvable = new Resolvable<RequestMapEntry>();

    // Обработчик запроса выстреливает один раз
    const handler: RequestHandler = (request, response, error) => {
      this._removeRequestHandler(handler);
      this._activeResponses = this._activeResponses.filter(r => r !== response);

      if (error) {
        resolvable.reject(error);
        return;
      }

      // Читаем тело запроса
      const body = bodyReader(request);

      resolvable.resolve({
        request,
        response,

        // Тут тело запроса парсится
        body(encoding?: BufferEncoding): Promise<any> {
          return body().then(buffer => {
            if (encoding === undefined) {
              return buffer;
            } else {
              return buffer.toString(encoding);
            }
          });
        },
      });
    };

    this._requestHandlers.push({ path, handler });

    // Setting up rejection by timeout
    const timer = setTimeout(() => {
      this._removeRequestHandler(handler);
      resolvable.reject(new Error('Timed out'));
    }, this._options.timeout);

    return resolvable.promise
      .then(result => [null, result])
      .catch(error => [error, null])
      .then(([error, result]) => {
        clearTimeout(timer);

        if (error) {
          return Promise.reject(error);
        } else {
          return Promise.resolve(result);
        }
      });
  }

  private _removeRequestHandler(handler: RequestHandler) {
    this._requestHandlers = this._requestHandlers.filter(
      h => h.handler !== handler
    );
  }
}

function mockHttpServer(
  options: Partial<MockHttpServerOptions> = {}
): MockHttpServerImpl {
  return new MockHttpServerImpl({
    ...options,
    port: options.port ?? generatePort(),
    timeout: options.timeout ?? 1000,
  });
}

export function useMockHttpServer(
  options: Partial<MockHttpServerOptions> = {}
): MockHttpServer {
  const server = mockHttpServer(options);

  beforeEach(() => {
    server.clear();
    return server.start();
  });

  afterEach(() => {
    return server.stop();
  });

  return server;
}
