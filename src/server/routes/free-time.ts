import { Router } from 'express';
import type { Db } from '../db/connection.js';
import { freeTime } from '../services/free-time.js';
import { taskQuerySchema } from '../../shared/schemas.js';
import { parseBody } from '../middleware.js';

export function freeTimeRouter(db: Db): Router {
  const router = Router();

  router.get('/free-time', (req, res) => {
    const { from, to } = parseBody(taskQuerySchema, req.query);
    res.json(freeTime(db, from, to));
  });

  return router;
}
