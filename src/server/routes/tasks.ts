import { Router } from 'express';
import type { Db } from '../db/connection.js';
import {
  createTask,
  deleteGroup,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
} from '../services/tasks.js';
import { taskInputSchema, taskQuerySchema, taskUpdateSchema } from '../../shared/schemas.js';
import { parseBody } from '../middleware.js';

export function tasksRouter(db: Db): Router {
  const router = Router();

  router.get('/tasks', (req, res) => {
    const { from, to } = parseBody(taskQuerySchema, req.query);
    res.json(listTasks(db, from, to));
  });

  router.post('/tasks', (req, res) => {
    const allowOverlap = req.body?.allowOverlap === true;
    const input = parseBody(taskInputSchema, req.body);
    const task = createTask(db, input, { allowOverlap });
    res.status(201).json(task);
  });

  router.patch('/tasks/:id', (req, res) => {
    const allowOverlap = req.body?.allowOverlap === true;
    const patch = parseBody(taskUpdateSchema, req.body);
    res.json(updateTask(db, Number(req.params.id), patch, { allowOverlap }));
  });

  router.delete('/tasks/:id', (req, res) => {
    deleteTask(db, Number(req.params.id));
    res.status(204).send();
  });

  router.delete('/groups/:id', (req, res) => {
    const count = deleteGroup(db, Number(req.params.id));
    res.json({ deleted: count });
  });

  router.get('/tasks/:id', (req, res) => {
    res.json(getTask(db, Number(req.params.id)));
  });

  return router;
}
