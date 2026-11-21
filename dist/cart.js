import { readLocal, saveLocal } from './db.js';

const CART_KEY = 'seoul-demo-cart';
let activeKey = CART_KEY;
export const readCart = () => readLocal(activeKey, []);
export const writeCart = rows => saveLocal(activeKey, rows);

export function setCartAccount(id, moveGuest = false) {
  activeKey = id ? CART_KEY + ':' + id : CART_KEY;
  if (!id || !moveGuest || readCart().length) return;
  const guest = readLocal(CART_KEY, []);
  if (guest.length) {
    writeCart(guest);
    localStorage.removeItem(CART_KEY);
  }
}

export function addCartMenu(item, store, quantity = 1) {
  return addCartMenus([{ item, quantity }], store);
}

export function addCartMenus(lines, store) {
  if (store?.is_open === false) throw new Error('현재 배달 주문을 받지 않는 가게입니다.');
  const rows = readCart();
  let total = 0;
  for (const { item, quantity } of lines) {
    if (!item?.available || !store || item.store_id !== store.id) {
      throw new Error('현재 담을 수 없는 메뉴가 있어요. 가게 메뉴를 확인해 주세요.');
    }
    const index = rows.findIndex(row => row.id === item.id);
    const nextQuantity = (rows[index]?.quantity || 0) + quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || nextQuantity > 20) {
      throw new Error('메뉴당 최대 20개까지 담을 수 있습니다.');
    }
    const row = { ...item, store_name: store.name, quantity: nextQuantity, selected: true };
    if (index === -1) rows.push(row);
    else rows[index] = row;
    total += nextQuantity;
  }
  writeCart(rows);
  return total;
}
