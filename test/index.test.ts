import {useMockHttpServer} from '../src';
import fetch from 'node-fetch';

describe('mockHttpServer', () => {
  describe('waitForRequest', () => {
    const server = useMockHttpServer();

    test('success', async () => {
      const requestPromise = server.waitForRequest('/test');

      const result = fetch(`${server.host}/test`, {method: 'POST', body: 'test_body'});

      await expect(requestPromise).resolves.toEqual({
        request: expect.any(Object),
        response: expect.any(Object),
        body: expect.any(Function),
      });

      const {response, body} = await requestPromise;

      await expect(body('utf-8')).resolves.toEqual('test_body');

      response.writeHead(299);
      response.write('test_response');
      response.end();

      const fetchResult = await result;

      expect(fetchResult.status).toEqual(299);
      await expect(fetchResult.text()).resolves.toEqual('test_response');
    });

    test('timeout server', () => {
      const requestPromise = server.waitForRequest('/test');

      return expect(requestPromise).rejects.toThrow('Timed out');
    });

    test('timeout client', () => {
      const result = fetch(`${server.host}/test`, {method: 'POST', body: 'test_body', timeout: 1000});

      return expect(result).rejects.toThrow('network timeout');
    });
  });

  describe('order', () => {
    const server = useMockHttpServer();

    test('success', async () => {
      const requests = Promise.all([
          server.waitForRequest('/1'),
          server.waitForRequest('/2'),
      ]);

      // Finishing all the requests
      requests.then((rs) => rs.forEach((r) => r.response.end()));

      const fetches = Promise.all([
          fetch(`${server.host}/1`),
          fetch(`${server.host}/2`),
      ]);

      await expect(fetches).resolves.toBeTruthy();
      await expect(requests).resolves.toBeTruthy();
    });
  });
});
