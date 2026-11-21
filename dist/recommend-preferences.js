import { readLocal, saveLocal } from './db.js';

const tastes = new Set(['매운', '안 매운', '담백', '고소']);
const extras = {
  wrap: ['wrap', 'skipExtra'],
  cola: ['cola', 'skipExtra'],
  priority: ['taste', 'price', 'skipExtra'],
};
const headcount = people => Number.isInteger(people) && people >= 1 && people <= 20
  ? `people:${people <= 4 ? people : 'other'}` : null;
const menu = category => typeof category === 'string' && category ? `menu:${category}` : null;
const taste = value => tastes.has(value) ? `taste:${value}` : null;
const extra = (kind, answer) => Object.hasOwn(extras, kind) && extras[kind].includes(answer) ? `extra:${kind}:${answer}` : null;
const count = (history, key) => Number.isSafeInteger(history[key]) && history[key] > 0 ? history[key] : 0;

export function choiceKey(group, action) {
  if (action?.type !== 'apply') return null;
  const { cond = {}, flowAnswer } = action;
  if (group === 'people') return flowAnswer === 'enterPeople' ? 'people:other' : headcount(cond.people);
  if (group === 'menu') return cond.anyMenu === true ? 'menu:any' : menu(cond.menu);
  if (group === 'taste') return flowAnswer === 'skipTaste' ? 'taste:any' : cond.taste?.length === 1 ? taste(cond.taste[0]) : null;
  return group?.startsWith('extra:') ? extra(group.slice(6), flowAnswer) : null;
}

function confirmedChoices(state) {
  const c = state?.cond;
  if (!c) return [];
  const foods = c.foods ?? [];
  return [
    headcount(c.people), c.anyMenu === true ? 'menu:any' : menu(c.menu),
    ...foods.map(food => menu(food.menu)),
    ...(c.taste ?? []).map(taste), ...foods.flatMap(food => (food.taste ?? []).map(taste)),
    state.flowTasteDone && !c.taste?.length ? 'taste:any' : null,
    state.flowExtraDone ? extra(state.flowExtraKind, state.flowPreference ?? 'skipExtra') : null,
  ].filter(Boolean);
}

export function recordPreferences(storageKey, action, previous, current, clicked) {
  if (!current?.staged || !['apply', 'text'].includes(action.type) || action.flowAnswer === 'enterPeople') return;
  const accepted = new Set(confirmedChoices(current));
  const chosen = clicked ?? menu(action.cond?.menu);
  // Carried conditions shouldn't gain votes each time someone sends another message.
  const alreadyAccepted = action.type === 'text' ? new Set(confirmedChoices(previous)) : null;
  const hits = action.type === 'text' ? [...accepted].filter(key => !alreadyAccepted.has(key))
    : chosen && accepted.has(chosen) ? [chosen] : [];
  if (!hits.length) return;
  const history = { ...readLocal(storageKey, {}) };
  for (const key of hits) history[key] = count(history, key) + 1;
  try { saveLocal(storageKey, history); } catch { /* Chat still works if storage is unavailable. */ }
}

export function preferredChoice(storageKey, keys) {
  const history = readLocal(storageKey, {});
  let largest = 1, preferred = null;
  for (const key of new Set(keys.filter(Boolean))) {
    const votes = count(history, key);
    if (votes > largest) { largest = votes; preferred = key; }
    else if (votes === largest) preferred = null;
  }
  return preferred;
}
