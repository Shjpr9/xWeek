import express from 'express';
import type { Db } from './db/connection.js';
import { errorMiddleware } from './middleware.js';
import { tasksRouter } from './routes/tasks.js';
import { settingsRouter } from './routes/settings.js';
import { freeTimeRouter } from './routes/free-time.js';
import { chatRouter } from './routes/chat.js';
import type { AIClient } from './ai/client.js';

export function createApp(db: Db, client?: AIClient): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/api/hello', (_req, res) => {
    res.json({ message: 'hello from xWeek server' });
  });

  app.use('/api', tasksRouter(db));
  app.use('/api', settingsRouter(db));
  app.use('/api', freeTimeRouter(db));
  app.use('/api', chatRouter(db, client));

  app.use(errorMiddleware);
  return app;
}
