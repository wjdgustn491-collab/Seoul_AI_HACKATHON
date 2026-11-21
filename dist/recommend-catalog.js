let indexRequest;

export function matchesOrderableStore(store, name, dong) {
  return !!store && store.name === name && store.district?.endsWith(' ' + dong) === true;
}

async function readCatalog(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error('추천 메뉴 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  return response.json();
}

export async function recommendationCartSelection(card) {
  const index = await (indexRequest ??= readCatalog('./data/index.json').catch(error => {
    indexRequest = undefined;
    throw error;
  }));
  const area = index.dongs.find(row => row.dong === card.catalogDong);
  if (!area) throw new Error('추천 메뉴의 동네 정보를 찾지 못했어요.');
  const catalog = await readCatalog(`./data/dong/${area.file}.json`);
  const source = catalog.stores.find(row => row.store_id === card.storeId);
  if (!source || source.is_open !== 'true' || source.delivery_available === 'false') {
    throw new Error('현재 배달 가능한 가게가 아니에요.');
  }
  const store = { id: `recommend:${source.store_id}`, name: source.name, is_open: true, delivery_fee: Number(source.delivery_tip) };
  const lines = (card.items ?? [{ menuId: card.menuId, qty: card.qty || 1 }]).map(line => {
    const sourceMenu = catalog.menus.find(row => row.store_id === source.store_id && row.menu_id === line.menuId);
    return {
      item: sourceMenu && {
        id: `recommend:${sourceMenu.menu_id}`, store_id: store.id, name: sourceMenu.name,
        price: Number(sourceMenu.price), available: true, catalogOnly: true, deliveryFee: store.delivery_fee,
      },
      quantity: line.qty,
    };
  });
  return { store, lines, source };
}
