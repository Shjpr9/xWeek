import { describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { app } from './app.js';
import { config } from './config.js';

describe('GET /api/hello', () => {
  it('responds with a greeting from the configured server', async () => {
    const server: Server = app.listen(0, config.HOST);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as { port: number };
    try {
      const res = await fetch(`http://${config.HOST}:${port}/api/hello`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        message: expect.stringContaining('xWeek'),
      });
    } finally {
      server.close();
    }
  });
});
