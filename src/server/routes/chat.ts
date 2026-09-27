import { Router } from 'express';
import type { Db } from '../db/connection.js';
import type { AIClient } from '../ai/client.js';
import { chat, listMessages } from '../ai/chat.js';
import { chatInputSchema } from '../../shared/schemas.js';
import { parseBody } from '../middleware.js';
import { ProviderError } from '../services/errors.js';

export function chatRouter(db: Db, client?: AIClient): Router {
  const router = Router();
  router.get('/chat/messages', (_req, res) => {
    res.json(listMessages(db));
  });
  router.post('/chat', async (req, res) => {
    const { message } = parseBody(chatInputSchema, req.body);
    if (!client) throw new ProviderError();
    res.json(await chat(db, client, message));
  });
  return router;
}
