import { describe, expect, it } from 'vitest';
import { blankTodo, completeTodo, initialData, isDue, localDate, parseData, safeUrl } from './model';

describe('workbench backup safety', () => {
  it('roundtrips workspaces without touching worksheet storage', () => {
    const data = initialData();
    data.spaces[0].todos.push({ ...blankTodo(), title: '备课', due: '2026-09-10T09:00' });
    expect(parseData(JSON.stringify(data))).toEqual(data);
  });
  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///C:/test', '/relative', 'not a url'])('rejects unsafe URL %s', url => {
    expect(safeUrl(url)).toBe(false);
    const data = initialData(); data.spaces[0].cards[0].url = url;
    expect(() => parseData(JSON.stringify(data))).toThrow();
  });
  it('rejects duplicate ids and missing active workspace', () => {
    const data = initialData(); data.spaces[1].id = data.spaces[0].id;
    expect(() => parseData(JSON.stringify(data))).toThrow();
    const other = initialData(); other.active = 'missing';
    expect(() => parseData(JSON.stringify(other))).toThrow();
  });
  it('rejects broken tasks, empty workspaces and unsupported versions', () => {
    for (const value of [{ ...initialData(), spaces: [] }, { ...initialData(), version: 2 }]) expect(() => parseData(JSON.stringify(value))).toThrow();
    const data = initialData(); data.spaces[0].todos.push({ ...blankTodo(), title: '测试', due: 'bad-date' });
    expect(() => parseData(JSON.stringify(data))).toThrow();
  });
});
describe('workbench reminders', () => {
  const now = new Date('2026-09-10T10:00').getTime();
  const todo = { ...blankTodo(), title: '备课', due: '2026-09-10T09:00' };
  it('shows missed reminders on next opening but never completed or dismissed tasks', () => {
    expect(isDue(todo, now)).toBe(true);
    expect(isDue({ ...todo, done: true }, now)).toBe(false);
    expect(isDue({ ...todo, notified: true }, now)).toBe(false);
    expect(isDue({ ...todo, due: '' }, now)).toBe(false);
    expect(isDue({ ...todo, due: '2026-09-10T11:00' }, now)).toBe(false);
  });
  it('reschedules an overdue daily task to its next future local occurrence', () => {
    const result = completeTodo({ ...todo, due: '2026-09-01T09:00', repeat: 'daily' }, now);
    expect(result.due).toBe('2026-09-11T09:00');
    expect(result.done).toBe(false); expect(result.notified).toBe(false);
  });
  it('preserves weekly cadence and allows reopening a one-time task', () => {
    expect(completeTodo({ ...todo, repeat: 'weekly' }, now).due).toBe('2026-09-17T09:00');
    const completed = completeTodo(todo, now);
    expect(completed.done).toBe(true);
    expect(completeTodo(completed, now).done).toBe(false);
    expect(localDate(new Date('2026-09-10T10:00'))).toBe('2026-09-10T10:00');
  });
});
