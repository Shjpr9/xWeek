import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Task, TaskInput } from '../shared/schemas.js';
import { fromMinutes, toMinutes } from '../shared/time.js';
import { ApiError, api } from './api.js';
import { dateLabel, type CalendarMode } from './calendar.js';
import styles from './app.module.css';

interface Props {
  date: string;
  time: string;
  task?: Task;
  mode: CalendarMode;
  onClose: () => void;
}

export function TaskDialog({ date, time, task, mode, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(task?.title ?? '');
  const [taskDate, setTaskDate] = useState(task?.task_date ?? date);
  const [start, setStart] = useState(task?.start_time ?? time);
  const [end, setEnd] = useState(task?.end_time ?? fromMinutes(Math.min(toMinutes(time) + 60, 1439)));
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);

  async function finish(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the task.');
      setConflict(cause instanceof ApiError && cause.status === 409);
      setConflicts(cause instanceof ApiError ? cause.conflicts : []);
    } finally {
      setBusy(false);
    }
  }

  function save(allowOverlap = false) {
    const input: TaskInput = {
      title: title.trim(), notes: notes.trim() || null, task_date: taskDate,
      start_time: start, end_time: end, status: task?.status ?? 'planned',
    };
    void finish(() => task
      ? api.updateTask(task.id, input, allowOverlap)
      : api.createTask(input, allowOverlap));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save();
  }

  return <dialog ref={dialog} className={styles.dialog} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="task-dialog-title">
    <div className={styles.dialogTop}>
      <div><span className={styles.eyebrow}>{task ? 'EDIT TASK' : 'NEW TASK'}</span><h2 id="task-dialog-title">{task ? 'Make a change' : 'Make room for it'}</h2></div>
      <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close task editor">×</button>
    </div>
    <p className={styles.dialogDate} lang={mode === 'persian' ? 'fa' : 'en'}>{dateLabel(taskDate, mode, 'full')}</p>
    <form onSubmit={submit} className={styles.taskForm}>
      <label>Title<input autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What are you planning?" /></label>
      <label>Date<input required type="date" value={taskDate} onChange={(event) => setTaskDate(event.target.value)} /></label>
      <div className={styles.formRow}>
        <label>Start<input required type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label>End<input required type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      </div>
      <label>Notes<textarea rows={3} maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Anything to remember?" /></label>
      {error && <div role="alert" className={styles.formError}><strong>{error}</strong>{conflicts.map((item) => <span key={item}>{item}</span>)}</div>}
      <div className={styles.dialogActions}>
        {task && <button type="button" className={styles.dangerText} disabled={busy} onClick={() => {
          if (window.confirm(`Delete “${task.title}”?`)) void finish(() => api.deleteTask(task.id));
        }}>Delete</button>}
        {task?.status !== 'done' && task && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void finish(() => api.updateTask(task.id, { status: 'done' }))}>Mark done</button>}
        {task?.status === 'done' && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void finish(() => api.updateTask(task.id, { status: 'planned' }))}>Mark planned</button>}
        <span className={styles.actionSpacer} />
        {conflict && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => save(true)}>Add anyway</button>}
        <button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? 'Saving…' : task ? 'Save task' : 'Add task'}</button>
      </div>
    </form>
  </dialog>;
}
