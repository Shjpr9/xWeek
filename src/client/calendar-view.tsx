import type { Settings, Task } from '../shared/schemas.js';
import { fromMinutes, toMinutes } from '../shared/time.js';
import { dateLabel, type CalendarMode } from './calendar.js';
import styles from './app.module.css';

interface Props {
  view: 'week' | 'month';
  mode: CalendarMode;
  cursor: string;
  days: string[];
  today: string;
  tasks: Task[];
  settings: Settings;
  onNew: (date: string, time: string) => void;
  onTask: (task: Task) => void;
  onDay: (date: string) => void;
}

function taskClass(task: Task): string {
  return `${styles.taskCard} ${task.status === 'done' ? styles.done : ''} ${styles[`tone${task.id % 4}`]}`;
}

export function CalendarView({ view, mode, cursor, days, today, tasks, settings, onNew, onTask, onDay }: Props) {
  const byDate = new Map(days.map((date) => [date, tasks.filter((task) => task.task_date === date)]));

  if (view === 'month') {
    const currentMonth = dateLabel(cursor, mode, 'month');
    return (
      <div lang={mode === 'persian' ? 'fa' : 'en'} className={`${styles.monthGrid} ${mode === 'persian' ? styles.rtl : ''}`}>
        {days.slice(0, 7).map((date) => <div className={styles.monthWeekday} key={date}>{dateLabel(date, mode, 'weekday')}</div>)}
        {days.map((date) => {
          const dayTasks = byDate.get(date) ?? [];
          return <div className={`${styles.monthDay} ${dateLabel(date, mode, 'month') !== currentMonth ? styles.outside : ''} ${date === today ? styles.today : ''}`} key={date}>
            <div className={styles.monthDayHead}>
              <button type="button" onClick={() => onDay(date)} aria-label={`Open week of ${date}`} className={styles.dayNumber}>{dateLabel(date, mode, 'day')}</button>
              <button type="button" onClick={() => onNew(date, settings.day_start)} aria-label={`Add task on ${date}`} className={styles.quietAdd}>+</button>
            </div>
            <div className={styles.monthTasks}>
              {dayTasks.slice(0, 3).map((task) => <button type="button" key={task.id} className={taskClass(task)} onClick={() => onTask(task)}>
                <span>{task.start_time}</span> {task.title}
              </button>)}
              {dayTasks.length > 3 && <button type="button" className={styles.more} onClick={() => onDay(date)}>+{dayTasks.length - 3} more</button>}
            </div>
          </div>;
        })}
      </div>
    );
  }

  const start = Math.floor(Math.min(toMinutes(settings.day_start), ...tasks.map((task) => toMinutes(task.start_time))) / 30) * 30;
  const end = Math.ceil(Math.max(toMinutes(settings.day_end), ...tasks.map((task) => toMinutes(task.end_time))) / 30) * 30;
  const slots = Array.from({ length: (end - start) / 30 }, (_, index) => start + index * 30);
  const scale = 1.2; // 72 pixels per hour
  const height = (end - start) * scale;

  return <div className={styles.weekScroller}>
    <div lang={mode === 'persian' ? 'fa' : 'en'} className={`${styles.weekGrid} ${mode === 'persian' ? styles.rtl : ''}`}>
      <div className={styles.timeHeading}>TIME</div>
      {days.map((date) => <div className={`${styles.weekHeading} ${date === today ? styles.today : ''}`} key={date}>
        <span>{dateLabel(date, mode, 'weekday')}</span>
        <strong>{dateLabel(date, mode, 'day')}</strong>
      </div>)}
      <div className={styles.timeRail} style={{ height }}>
        {slots.filter((minute) => minute % 60 === 0).map((minute) => <span key={minute} style={{ top: (minute - start) * scale }}>{fromMinutes(minute)}</span>)}
      </div>
      {days.map((date) => <div className={`${styles.dayTrack} ${date === today ? styles.todayTrack : ''}`} style={{ height }} key={date}>
        {slots.map((minute) => <button type="button" key={minute} className={styles.slot} style={{ top: (minute - start) * scale, height: 30 * scale }}
          aria-label={`Add task on ${date} at ${fromMinutes(minute)}`} onClick={() => onNew(date, fromMinutes(minute))} />)}
        {(byDate.get(date) ?? []).map((task) => <button type="button" key={task.id} className={taskClass(task)}
          style={{ top: (toMinutes(task.start_time) - start) * scale, height: Math.max((toMinutes(task.end_time) - toMinutes(task.start_time)) * scale, 28) }}
          onClick={() => onTask(task)} aria-label={`${task.title}, ${task.start_time} to ${task.end_time}, ${date}`}>
          <strong>{task.title}</strong><span>{task.start_time}–{task.end_time}</span>
        </button>)}
      </div>)}
    </div>
  </div>;
}
