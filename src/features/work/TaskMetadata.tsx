import { useState } from 'react';
import type { WorkSummary } from './model';
import { displayDate, today } from './dates';

export function TaskMetadata({ item, now }: { item: Pick<WorkSummary, 'priority' | 'status' | 'due_date'>; now?: number }) {
  const [openedAt] = useState(() => Date.now());
  const currentDate = today(new Date(now ?? openedAt));
  const active = !['Complete', 'Cancelled'].includes(item.status);
  const overdue = active && !!item.due_date && item.due_date < currentDate;
  const dueToday = active && item.due_date === currentDate;
  return <dl className="task-metadata">
    <div><dt>Priority</dt><dd><span className={`task-badge priority-${item.priority.toLowerCase()}`}>{item.priority}</span></dd></div>
    <div className={overdue ? 'task-due-overdue' : dueToday ? 'task-due-today' : ''}><dt>Due date</dt><dd>{item.due_date ? <time dateTime={item.due_date}>{displayDate(item.due_date)}</time> : 'No due date'}{overdue ? ' · Overdue' : dueToday ? ' · Today' : ''}</dd></div>
    <div><dt>Status</dt><dd><span className={`task-badge task-status-${item.status.toLowerCase().replaceAll(' ', '-')}`}>{item.status}</span></dd></div>
  </dl>;
}
