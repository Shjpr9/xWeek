import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { addDays, todayInTz, toMinutes, weekRange } from '../shared/time.js';
import type { Task } from '../shared/schemas.js';
import { api } from './api.js';
import { CalendarView } from './calendar-view.js';
import { ChatPanel } from './chat-panel.js';
import { daysInRange, dateLabel, monthRange, shiftCalendarMonth, type CalendarMode } from './calendar.js';
import { TaskDialog } from './task-dialog.js';
import styles from './app.module.css';

const queryClient = new QueryClient();
const savedTheme = localStorage.getItem('xweek-theme');
const initialTheme = savedTheme === 'dark' || (savedTheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
document.documentElement.dataset.theme = initialTheme;

function App() {
  const [theme, setTheme] = useState(initialTheme);
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [view, setView] = useState<'week' | 'month'>('week');
  const [mode, setMode] = useState<CalendarMode>('persian');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ date: string; time: string; task?: Task } | null>(null);
  const today = todayInTz(settings.data?.timezone ?? 'UTC');
  const cursor = selectedDate ?? today;
  const weekStart = mode === 'persian' ? 6 : (settings.data?.week_starts_on ?? 1);
  const range = view === 'week' ? weekRange(cursor, weekStart) : monthRange(cursor, weekStart, mode);
  const days = daysInRange(range.start, range.end);
  const tasks = useQuery({
    queryKey: ['tasks', range.start, range.end], queryFn: () => api.tasks(range.start, range.end),
    enabled: !!settings.data,
  });

  function navigate(amount: number) {
    setSelectedDate(view === 'week' ? addDays(cursor, amount * 7) : shiftCalendarMonth(cursor, amount, mode));
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('xweek-theme', next);
  }

  const title = view === 'month'
    ? dateLabel(cursor, mode, 'month')
    : `${dateLabel(range.start, mode, 'full')} – ${dateLabel(range.end, mode, 'full')}`;
  const scheduledMinutes = (tasks.data ?? []).reduce((total, task) => total + toMinutes(task.end_time) - toMinutes(task.start_time), 0);

  return <div className={styles.shell}>
    <header className={styles.topbar}>
      <a className={styles.brand} href="/" aria-label="xWeek home"><span className={styles.brandMark}>✳</span><span>x<span>Week</span></span></a>
      <div className={styles.topbarRight}><button type="button" className={styles.themeToggle} onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-pressed={theme === 'dark'}>{theme === 'dark' ? '☀ Light' : '☾ Dark'}</button><span className={styles.timezone}>{settings.data?.timezone ?? 'Loading timezone…'}</span><span className={styles.topbarDivider} /><span className={styles.topbarToday} lang={mode === 'persian' ? 'fa' : 'en'}>{dateLabel(today, mode, 'full')}</span></div>
    </header>
    <div className={styles.workspace}>
      <main className={styles.main}>
        <div className={styles.pageIntro}>
          <div><span className={styles.eyebrow}>YOUR SPACE TO PLAN</span><h1>Make time for <em>what matters.</em></h1><p>A calmer view of the days ahead.</p></div>
          <button type="button" className={styles.primaryButton} onClick={() => setEditor({ date: cursor, time: settings.data?.day_start ?? '09:00' })}>+ New task</button>
        </div>

        <div className={styles.overview}>
          <div><span>IN VIEW</span><strong>{(tasks.data ?? []).length}</strong><small>tasks planned</small></div>
          <div><span>TIME SET ASIDE</span><strong>{Math.round(scheduledMinutes / 60 * 10) / 10}<small>h</small></strong><small>for your priorities</small></div>
          <div className={styles.overviewNote}><span>✦</span><p>Small steps make a full week.</p></div>
        </div>

        <section className={styles.calendarPanel} aria-label="Calendar">
          <div className={styles.calendarToolbar}>
            <div className={styles.periodControl}>
              <button type="button" className={styles.navButton} onClick={() => navigate(-1)} aria-label="Previous period">‹</button>
              <button type="button" className={styles.navButton} onClick={() => navigate(1)} aria-label="Next period">›</button>
              <button type="button" className={styles.todayButton} onClick={() => setSelectedDate(null)}>Today</button>
              <h2 dir="auto" lang={mode === 'persian' ? 'fa' : 'en'}>{title}</h2>
            </div>
            <div className={styles.toolbarToggles}>
              <div className={styles.segmented} aria-label="Calendar system">
                <button type="button" aria-pressed={mode === 'persian'} onClick={() => setMode('persian')}>شمسی</button>
                <button type="button" aria-pressed={mode === 'gregorian'} onClick={() => setMode('gregorian')}>Gregorian</button>
              </div>
              <div className={styles.segmented} aria-label="Calendar view">
                <button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</button>
                <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</button>
              </div>
            </div>
          </div>
          {settings.isPending && <p className={styles.panelState}>Loading your settings…</p>}
          {settings.isError && <p className={styles.panelState} role="alert">Could not load settings. <button type="button" onClick={() => void settings.refetch()}>Try again</button></p>}
          {settings.data && tasks.isPending && <p className={styles.panelState}>Loading your calendar…</p>}
          {settings.data && tasks.isError && <p className={styles.panelState} role="alert">Could not load tasks. <button type="button" onClick={() => void tasks.refetch()}>Try again</button></p>}
          {settings.data && tasks.data && <>
            {tasks.data.length === 0 && <div className={styles.emptyBanner}>Nothing planned here yet. Select a time to add your first task.</div>}
            <CalendarView view={view} mode={mode} cursor={cursor} days={days} today={today} tasks={tasks.data} settings={settings.data}
              onNew={(date, time) => setEditor({ date, time })} onTask={(task) => setEditor({ date: task.task_date, time: task.start_time, task })}
              onDay={(date) => { setSelectedDate(date); setView('week'); }} />
          </>}
        </section>
      </main>
      <ChatPanel />
    </div>
    {editor && <TaskDialog key={`${editor.task?.id ?? 'new'}-${editor.date}-${editor.time}`} {...editor} mode={mode} onClose={() => setEditor(null)} />}
  </div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></StrictMode>,
);
