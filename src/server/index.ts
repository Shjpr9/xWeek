import { createApp } from './app.js';
import { config } from './config.js';
import { openDb } from './db/connection.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createOpenAIClient } from './ai/client.js';

mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });
const db = openDb(config.DATABASE_PATH);

const client = config.OPENAI_API_KEY
  ? createOpenAIClient({
      apiKey: config.OPENAI_API_KEY,
      baseURL: config.OPENAI_BASE_URL,
      model: config.OPENAI_MODEL,
    })
  : undefined;

createApp(db, client).listen(config.PORT, config.HOST, () => {
  console.log(`xWeek listening on http://${config.HOST}:${config.PORT}`);
});
