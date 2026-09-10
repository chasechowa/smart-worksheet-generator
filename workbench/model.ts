export type Card = { id: string; title: string; description: string; url: string; icon: string; color: string; type: 'link' | 'note'; mode: 'detail' | 'compact'; newTab: boolean };
export type Todo = { id: string; title: string; due: string; done: boolean; repeat: 'none' | 'daily' | 'weekly'; notified: boolean };
export type Space = { id: string; name: string; cards: Card[]; todos: Todo[]; note: string };
export type Data = { version: 1; spaces: Space[]; active: string; showTodo: boolean; showNote: boolean; layout: 'grid' | 'list'; theme: 'cream' | 'sage' };
export const KEY = 'personal_workbench_v1';
export const uid = () => crypto.randomUUID();
export const blankCard = (): Card => ({ id: uid(), title: '', description: '', url: '', icon: '↗', color: 'sage', type: 'link', mode: 'detail', newTab: true });
export const blankTodo = (): Todo => ({ id: uid(), title: '', due: '', done: false, repeat: 'none', notified: false });
export function safeUrl(value: string): boolean { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } }
export function initialData(): Data {
  return { version: 1, active: 'teaching', showTodo: true, showNote: true, layout: 'grid', theme: 'cream', spaces: [
    { id: 'teaching', name: '教学备课', cards: [
      { ...blankCard(), title: '阅读出题', description: '从一篇文章，开始一堂好课', url: 'https://comprequiz.chao.asia', icon: '文', color: 'sage' },
      { ...blankCard(), title: '词汇工坊', description: '词汇学习与练习的常用入口', url: 'https://vocabforge-ai.chao.asia', icon: 'Aa', color: 'sand' },
      { ...blankCard(), type: 'note', title: '我的备课清单', description: '选一篇好文章\n确定教学目标\n出题后检查答案与难度', icon: '✎', color: 'lavender' },
    ], todos: [], note: '' },
    { id: 'personal', name: '个人生活', cards: [], todos: [], note: '' },
  ] };
}
export function isDue(todo: Todo, now: number): boolean { return !todo.done && !todo.notified && !!todo.due && new Date(todo.due).getTime() <= now; }
export function completeTodo(todo: Todo, now = Date.now()): Todo {
  if (todo.repeat !== 'none' && todo.due && !todo.done) {
    const next = new Date(todo.due); const days = todo.repeat === 'daily' ? 1 : 7;
    do { next.setDate(next.getDate() + days); } while (next.getTime() <= now);
    return { ...todo, due: localDate(next), done: false, notified: false };
  }
  return { ...todo, done: !todo.done, notified: !todo.done };
}
export function localDate(date: Date): string { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
export function parseData(raw: string): Data {
  const d = JSON.parse(raw);
  const str = (v: unknown, max = 10000) => typeof v === 'string' && v.length <= max;
  if (d.version !== 1 || !Array.isArray(d.spaces) || !d.spaces.length || d.spaces.length > 50 ||
    !['grid','list'].includes(d.layout) || !['cream','sage'].includes(d.theme) || typeof d.showTodo !== 'boolean' || typeof d.showNote !== 'boolean') throw new Error('备份格式不正确');
  const ids = new Set<string>();
  const id = (v: unknown) => { if (!str(v, 100) || !v || ids.has(v as string)) return false; ids.add(v as string); return true; };
  for (const s of d.spaces) {
    if (!s || !id(s.id) || !str(s.name, 40) || !s.name.trim() || !str(s.note, 50000) || !Array.isArray(s.cards) || s.cards.length > 500 || !Array.isArray(s.todos) || s.todos.length > 2000) throw new Error('工作空间数据不正确');
    for (const c of s.cards) if (!c || !id(c.id) || !str(c.title, 80) || !c.title.trim() || !str(c.description) || !str(c.icon, 12) || !str(c.url, 4000) || !['sage','sand','lavender','rose','blue'].includes(c.color) || !['link','note'].includes(c.type) || !['detail','compact'].includes(c.mode) || typeof c.newTab !== 'boolean' || (c.type === 'link' && !safeUrl(c.url))) throw new Error('卡片数据或链接不正确');
    for (const t of s.todos) if (!t || !id(t.id) || !str(t.title, 200) || !t.title.trim() || !str(t.due, 40) || (t.due && !Number.isFinite(new Date(t.due).getTime())) || typeof t.done !== 'boolean' || typeof t.notified !== 'boolean' || !['none','daily','weekly'].includes(t.repeat) || (t.repeat !== 'none' && !t.due)) throw new Error('待办数据不正确');
  }
  if (!d.spaces.some((s: Space) => s.id === d.active)) throw new Error('当前空间不存在');
  return d as Data;
}
