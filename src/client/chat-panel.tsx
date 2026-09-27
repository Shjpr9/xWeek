import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatChange } from '../shared/schemas.js';
import { api } from './api.js';
import styles from './app.module.css';

const suggestions = [
  'How much free time do I have this week?',
  'Help me plan a focused study session',
  'Can I fit a part-time job into my week?',
];

export function ChatPanel() {
  const queryClient = useQueryClient();
  const messages = useQuery({ queryKey: ['messages'], queryFn: api.messages });
  const [draft, setDraft] = useState('');
  const [changes, setChanges] = useState<ChatChange[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const send = useMutation({
    mutationFn: api.chat,
    onSuccess: async (result) => {
      setChanges(result.changes);
      setDraft('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['messages'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]);
    },
  });

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.data, send.isPending]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.trim() && !send.isPending) send.mutate(draft.trim());
  }

  return <aside className={styles.chatPanel} aria-label="Planner chat">
    <div className={styles.chatHeader}>
      <div className={styles.chatAvatar}>✦</div>
      <div><h2>Ask xWeek</h2><p>Your planning companion</p></div>
      <span className={styles.onlineDot} aria-label="Ready" />
    </div>
    <div className={styles.messages} aria-live="polite">
      {messages.isPending && <p className={styles.muted}>Loading conversation…</p>}
      {messages.isError && <div role="alert" className={styles.inlineError}>Could not load chat history. <button type="button" onClick={() => void messages.refetch()}>Try again</button></div>}
      {messages.data?.length === 0 && <div className={styles.chatEmpty}>
        <div className={styles.chatEmptyIcon}>✦</div>
        <h3>What’s on your mind?</h3>
        <p>Tell me what you need to do, or ask about the time you have.</p>
        <div className={styles.suggestions}>{suggestions.map((text) => <button type="button" key={text} onClick={() => setDraft(text)}>{text}</button>)}</div>
      </div>}
      {messages.data?.map((message) => <div key={message.id} className={`${styles.message} ${message.role === 'user' ? styles.userMessage : styles.assistantMessage}`}>
        {message.role === 'assistant' && <span className={styles.messageIcon}>✦</span>}
        <p dir="auto">{message.content}</p>
      </div>)}
      {send.isPending && <div className={`${styles.message} ${styles.assistantMessage}`}><span className={styles.messageIcon}>✦</span><p>Thinking…</p></div>}
      {changes.length > 0 && <div className={styles.changeSummary}>
        <strong>{changes.length} {changes.length === 1 ? 'change' : 'changes'} made</strong>
        {changes.slice(0, 4).map((change, index) => <span key={`${change.task_id}-${index}`}>{change.action} · {(change.after ?? change.before)?.title}</span>)}
        {changes.length > 4 && <span>+{changes.length - 4} more</span>}
      </div>}
      <div ref={bottom} />
    </div>
    <form className={styles.chatCompose} onSubmit={submit}>
      {send.isError && <p role="alert" className={styles.inlineError}>{send.error.message}</p>}
      <label className={styles.srOnly} htmlFor="chat-message">Message xWeek</label>
      <textarea id="chat-message" dir="auto" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
        placeholder="Ask me to plan your week…" disabled={send.isPending} />
      <div className={styles.chatComposeBottom}><span>Enter to send · Shift+Enter for a line break</span><button type="submit" className={styles.sendButton} disabled={!draft.trim() || send.isPending} aria-label="Send message">↑</button></div>
    </form>
  </aside>;
}
