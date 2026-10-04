'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { Check, Layers, MapPin, Pencil, Plus, RotateCcw, ShoppingBasket, Trash2, Upload } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { areaCenter, areaFromDrag, categoryName, moveProductsWithArea, placeProductInCategory, pointInArea, productLocation, type AreaDrag } from '@/lib/catalog';
import type { Area, Category, Product, StoreData, StoreSnapshot } from '@/lib/store';

type View = 'shopping' | 'products' | 'categories' | 'map';
type Selection = { kind: 'product' | 'category' | 'missing'; id: string };
type Marker = { key: string; label: string; x: number; y: number; kind: 'product' | 'shopping'; selection: Selection; count?: number };
type AreaOverlay = { key: string; label: string; area: Area; categoryId: string };
type CategorySuggestion = { categoryId: string; percentage: number };
type SuggestionResult = { suggestions: CategorySuggestion[]; recommendedCategoryId: string | null };
const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const parseList = (input: string) => Array.from(new Map(input.split(/\r?\n|,/)
  .map(line => line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, '').trim())
  .filter(Boolean).map(name => [normalize(name), name] as const)).values()).slice(0, 300);

function CategoryPicker({ categories, value, onChange, label }: {
  categories: Category[]; value: string | null; onChange: (id: string | null) => void; label: string;
}) {
  return <Select value={value ?? 'none'} onValueChange={id => onChange(id === 'none' ? null : id)}>
    <SelectTrigger className="category-select" aria-label={label}><SelectValue placeholder="Uncategorized" /></SelectTrigger>
    <SelectContent><SelectItem value="none">Uncategorized</SelectItem>
      {categories.map(category => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
    </SelectContent>
  </Select>;
}

export default function Page() {
  const [view, setView] = useState<View>('shopping');
  const [store, setStore] = useState<StoreSnapshot | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [listText, setListText] = useState('');
  const [newProductName, setNewProductName] = useState('');
  const [newProductCategory, setNewProductCategory] = useState<string | null>(null);
  const [categorySuggestions, setCategorySuggestions] = useState<CategorySuggestion[]>([]);
  const [recommendedCategoryId, setRecommendedCategoryId] = useState<string | null>(null);
  const [suggestionsFor, setSuggestionsFor] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState('');
  const manualCategoryChoice = useRef(false);
  const suggestionGeneration = useRef(0);
  const suggestionRequest = useRef<{ key: string; promise: Promise<SuggestionResult> } | null>(null);
  const addingProduct = useRef(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [keyboardPoint, setKeyboardPoint] = useState({ x: 0.5, y: 0.5 });
  const [draftArea, setDraftArea] = useState<Area | null>(null);
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [redrawArea, setRedrawArea] = useState(false);
  const areaDrag = useRef<AreaDrag | null>(null);
  const areaBeforeDrag = useRef<Area | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deleteProductTarget, setDeleteProductTarget] = useState<Product | null>(null);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<Category | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load your store.');
      setStore(data);
      setListText(data.shoppingList.join('\n'));
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load your store.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const categorySignature = (store?.categories ?? []).map(category => `${category.id}:${category.name}`).join('|');
  const requestSuggestions = useCallback((name: string, signature: string) => {
    const key = `${normalize(name)}|${signature}`;
    if (suggestionRequest.current?.key === key) return suggestionRequest.current.promise;
    const promise = fetch('/api/category-suggestions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    }).then(async response => {
      const result = await response.json() as SuggestionResult & { error?: string };
      if (!response.ok) throw new Error(result.error || 'AI suggestions are unavailable.');
      return { suggestions: result.suggestions ?? [], recommendedCategoryId: result.recommendedCategoryId ?? null };
    }).catch(error => {
      if (suggestionRequest.current?.key === key) suggestionRequest.current = null;
      throw error;
    });
    suggestionRequest.current = { key, promise };
    return promise;
  }, []);
  useEffect(() => {
    const name = newProductName.trim().replace(/\s+/g, ' ');
    const generation = ++suggestionGeneration.current;
    if (view !== 'products' || name.length < 2 || name.length > 100 || !store?.categories.length) {
      setSuggesting(false);
      return;
    }
    const timer = setTimeout(() => {
      setSuggesting(true);
      void requestSuggestions(name, categorySignature).then(result => {
        if (generation !== suggestionGeneration.current) return;
        const valid = result.suggestions.filter(item => store.categories.some(category => category.id === item.categoryId));
        const recommended = valid.some(item => item.categoryId === result.recommendedCategoryId) ? result.recommendedCategoryId : null;
        setCategorySuggestions(valid);
        setRecommendedCategoryId(recommended);
        setSuggestionsFor(`${normalize(name)}|${categorySignature}`);
        setSuggestionError('');
        if (!manualCategoryChoice.current) setNewProductCategory(recommended);
      }).catch(cause => {
        if (generation !== suggestionGeneration.current) return;
        setSuggestionError(cause instanceof Error ? cause.message : 'AI suggestions are unavailable.');
      }).finally(() => { if (generation === suggestionGeneration.current) setSuggesting(false); });
    }, 600);
    return () => clearTimeout(timer);
  }, [newProductName, categorySignature, view, store?.categories, requestSuggestions]);

  async function save(patch: Partial<Pick<StoreData, 'products' | 'categories' | 'shoppingList'>>) {
    if (!store || busy) return false;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/state', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: store.revision, products: patch.products ?? store.products,
          categories: patch.categories ?? store.categories, shoppingList: patch.shoppingList ?? store.shoppingList }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save.');
      setStore(data);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save.'); return false; }
    finally { setBusy(false); }
  }

  const productsByName = useMemo(() => new Map((store?.products ?? []).map(product => [normalize(product.name), product])), [store]);
  const known = (store?.shoppingList ?? []).filter(name => {
    const product = productsByName.get(normalize(name));
    return product && productLocation(product, store?.categories ?? []);
  });
  const unknown = (store?.shoppingList ?? []).filter(name => {
    const product = productsByName.get(normalize(name));
    return !product || !productLocation(product, store?.categories ?? []);
  });
  const visibleProducts = (store?.products ?? []).filter(product => normalize(product.name).includes(normalize(search))).sort((a,b) => a.name.localeCompare(b.name));
  const visibleCategories = [...(store?.categories ?? [])].sort((a,b) => a.name.localeCompare(b.name));
  const activeProduct = selected?.kind === 'product' ? store?.products.find(product => product.id === selected.id) : null;
  const activeCategory = selected?.kind === 'category' ? store?.categories.find(category => category.id === selected.id) : null;
  const editingArea = !!activeCategory && editingAreaId === activeCategory.id;
  const activeLabel = activeProduct?.name ?? activeCategory?.name ?? selected?.id ?? '';
  const mapUrl = store?.map ? `/api/map?v=${store.map.version}` : '';

  const markers = useMemo(() => {
    if (!store) return [] as Marker[];
    const displayProducts = editingArea && activeCategory && draftArea
      ? activeCategory.area
        ? moveProductsWithArea(store.products, activeCategory.id, activeCategory.area, draftArea)
        : store.products.map(product => product.categoryId === activeCategory.id ? placeProductInCategory(product, [{ ...activeCategory, area: draftArea }], true) : product)
      : store.products;
    if (view === 'categories') return displayProducts.filter(product => product.categoryId === selected?.id && product.x !== null && product.y !== null)
      .map(product => ({ key: `p-${product.id}`, label: product.name, x: product.x!, y: product.y!, kind: 'product' as const, selection: { kind: 'product' as const, id: product.id } }));
    if (view === 'shopping') {
      const groups = new Map<string, Marker>();
      for (const name of store.shoppingList) {
        const product = productsByName.get(normalize(name));
        if (!product) continue;
        const location = productLocation(product, store.categories);
        if (!location || location.kind !== 'point') continue;
        const key = `${location.x.toFixed(5)}:${location.y.toFixed(5)}`;
        const existing = groups.get(key);
        if (existing) { existing.label += `, ${name}`; existing.count = (existing.count ?? 1) + 1; }
        else groups.set(key, { key, label: name, x: location.x, y: location.y, kind: 'shopping', count: 1, selection: { kind: 'product', id: product.id } });
      }
      return [...groups.values()];
    }
    const productMarkers: Marker[] = displayProducts.filter(product => product.x !== null && product.y !== null)
      .map(product => ({ key: `p-${product.id}`, label: product.name, x: product.x!, y: product.y!, kind: 'product' as const, selection: { kind: 'product' as const, id: product.id } }));
    return productMarkers;
  }, [store, view, productsByName, selected, activeCategory, draftArea, editingArea]);
  const areas = useMemo(() => {
    if (!store) return [] as AreaOverlay[];
    const included = view === 'shopping'
      ? new Set(store.shoppingList.map(name => productsByName.get(normalize(name)))
          .filter((product): product is Product => !!product && product.x === null && !!productLocation(product, store.categories))
          .map(product => product.categoryId).filter((id): id is string => !!id))
      : null;
    return store.categories.filter(category => category.area && (!included || included.has(category.id)) && !(editingArea && category.id === activeCategory?.id))
      .map(category => ({ key: category.id, categoryId: category.id, area: category.area!,
        label: view === 'shopping' ? `${category.name}: ${store.shoppingList.filter(name => {
          const product = productsByName.get(normalize(name));
          return product?.categoryId === category.id && product.x === null;
        }).join(', ')}` : category.name }));
  }, [store, view, productsByName, editingArea, activeCategory]);

  function selectProduct(product: Product) {
    setSelected({ kind: 'product', id: product.id });
    const location = productLocation(product, store?.categories ?? []);
    setKeyboardPoint(location?.kind === 'point' ? { x: location.x, y: location.y } : location?.kind === 'area' ? areaCenter(location.area) : { x: 0.5, y: 0.5 });
    setMessage(product.x !== null ? `Click the map to move ${product.name}.` : location ? `${product.name} uses its category area. Click the map to give it a specific point.` : `Click the map to place ${product.name}.`);
  }
  function selectCategory(category: Category) {
    setSelected({ kind: 'category', id: category.id });
    setDraftArea(category.area);
    setEditingAreaId(null);
    setRedrawArea(false);
    setMessage(`Click Edit to ${category.area ? 'reshape' : 'draw'} the ${category.name} area.`);
  }
  function editCategoryArea(category: Category) {
    setSelected({ kind: 'category', id: category.id });
    setDraftArea(category.area);
    setEditingAreaId(category.id);
    setRedrawArea(false);
    setMessage(category.area ? `Drag inside ${category.name} to move it, or drag an edge to resize it. Press Enter or Save changes when ready.` : `Draw the ${category.name} area, then press Enter or Save changes.`);
  }
  function cancelCategoryArea() {
    setDraftArea(activeCategory?.area ?? null);
    setEditingAreaId(null);
    setRedrawArea(false);
    setMessage('Category changes cancelled.');
  }
  function selectMissing(name: string) {
    const product = productsByName.get(normalize(name));
    if (product) selectProduct(product);
    else { setSelected({ kind: 'missing', id: name }); setKeyboardPoint({ x: 0.5, y: 0.5 }); setMessage(`Click the map where you find ${name}.`); }
  }
  function selectMarker(marker: Marker) {
    if (!store) return;
    const product = store.products.find(item => item.id === marker.selection.id);
    if (product) selectProduct(product);
  }
  async function placeAt(x: number, y: number) {
    if (!store?.map || !selected || selected.kind === 'category' || busy) return;
    const existing = selected.kind === 'product' ? store.products.find(product => product.id === selected.id) : null;
    if (selected.kind === 'product' && !existing) return;
    const name = existing?.name ?? selected.id.trim();
    const categoryId = existing ? existing.categoryId : newProductCategory;
    const category = store.categories.find(item => item.id === categoryId);
    if (categoryId && !category?.area) { setError('Draw this category’s area before placing a product in it.'); return; }
    if (category?.area && !pointInArea({ x, y }, category.area)) { setError(`Place ${name} inside the ${category.name} area.`); return; }
    const product: Product = existing ? { ...existing, x, y } : { id: crypto.randomUUID(), name, categoryId, x, y };
    if (await save({ products: existing ? store.products.map(item => item.id === existing.id ? product : item) : [...store.products, product] })) {
      setSelected(null); setMessage(`${name} saved on the map.`);
    }
  }
  function placeOnMap(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    void placeAt(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)));
  }
  function positionFromPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  async function saveCategoryArea(area: Area) {
    if (!store?.map || selected?.kind !== 'category' || !editingArea || busy) return;
    const category = store.categories.find(item => item.id === selected.id);
    if (!category) return;
    const categories = store.categories.map(item => item.id === category.id ? { ...item, area } : item);
    const moved = category.area ? moveProductsWithArea(store.products, category.id, category.area, area) : store.products;
    const products = moved.map(product => product.categoryId === category.id
      ? placeProductInCategory(product, categories, !category.area && product.x === null)
      : product);
    if (await save({ categories, products })) {
      setDraftArea(area); setEditingAreaId(null); setRedrawArea(false); setMessage(`${category.name} area and its product pins saved.`);
    }
  }
  function areaPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!editingArea || busy) return;
    event.preventDefault();
    event.currentTarget.focus();
    const point = positionFromPointer(event);
    const area = draftArea;
    areaBeforeDrag.current = area;
    if (area && !redrawArea) {
      const rect = event.currentTarget.getBoundingClientRect();
      const edgeX = 12 / rect.width;
      const edgeY = 12 / rect.height;
      const inside = point.x >= area.x && point.x <= area.x + area.width && point.y >= area.y && point.y <= area.y + area.height;
      const near = point.x >= area.x - edgeX && point.x <= area.x + area.width + edgeX && point.y >= area.y - edgeY && point.y <= area.y + area.height + edgeY;
      const leftDistance = Math.abs(point.x - area.x);
      const rightDistance = Math.abs(point.x - area.x - area.width);
      const topDistance = Math.abs(point.y - area.y);
      const bottomDistance = Math.abs(point.y - area.y - area.height);
      const edges = {
        left: near && leftDistance <= edgeX && leftDistance <= rightDistance,
        right: near && rightDistance <= edgeX && rightDistance < leftDistance,
        top: near && topDistance <= edgeY && topDistance <= bottomDistance,
        bottom: near && bottomDistance <= edgeY && bottomDistance < topDistance,
      };
      areaDrag.current = edges.left || edges.right || edges.top || edges.bottom
        ? { mode: 'resize', start: point, original: area, edges }
        : inside ? { mode: 'move', start: point, original: area } : { mode: 'draw', start: point };
    } else areaDrag.current = { mode: 'draw', start: point };
    if (areaDrag.current.mode === 'draw') setDraftArea(areaFromDrag(areaDrag.current, point));
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function areaPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!areaDrag.current) return;
    setDraftArea(areaFromDrag(areaDrag.current, positionFromPointer(event)));
  }
  function areaPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!areaDrag.current) return;
    const drag = areaDrag.current;
    areaDrag.current = null;
    areaBeforeDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const end = positionFromPointer(event);
    const area = drag.mode === 'draw' && Math.abs(end.x - drag.start.x) < 0.005 && Math.abs(end.y - drag.start.y) < 0.005
      ? { x: Math.max(0, Math.min(0.92, drag.start.x - 0.04)), y: Math.max(0, Math.min(0.92, drag.start.y - 0.04)), width: 0.08, height: 0.08 }
      : areaFromDrag(drag, end);
    setDraftArea(area);
    setRedrawArea(false);
  }
  function mapKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!selected) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    if (selected.kind === 'category') {
      if (!editingArea) return;
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
        event.preventDefault();
        setDraftArea(previous => {
          const area = previous ?? { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
          const dx = event.key === 'ArrowRight' ? 0.01 : event.key === 'ArrowLeft' ? -0.01 : 0;
          const dy = event.key === 'ArrowDown' ? 0.01 : event.key === 'ArrowUp' ? -0.01 : 0;
          if (event.shiftKey) return { ...area, width: Math.max(0.005, Math.min(1 - area.x, area.width + dx)), height: Math.max(0.005, Math.min(1 - area.y, area.height + dy)) };
          return { ...area, x: Math.max(0, Math.min(1 - area.width, area.x + dx)), y: Math.max(0, Math.min(1 - area.height, area.y + dy)) };
        });
      } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (draftArea) void saveCategoryArea(draftArea); }
      return;
    }
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
      event.preventDefault();
      setKeyboardPoint(point => ({ x: Math.max(0, Math.min(1, point.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0))), y: Math.max(0, Math.min(1, point.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0))) }));
    } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void placeAt(keyboardPoint.x, keyboardPoint.y); }
  }

  async function submitList() {
    if (!store) return;
    const items = parseList(listText);
    if (items.some(name => name.length > 100)) { setError('Product names must be 100 characters or fewer.'); return; }
    if (await save({ shoppingList: items })) { setSelected(null); setDone([]); setMessage(`${items.length} item${items.length === 1 ? '' : 's'} on your list.`); }
  }
  async function addProduct(overrideCategoryId?: string | null) {
    if (!store || addingProduct.current) return;
    const name = newProductName.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 100) { setError('Enter a product name of up to 100 characters.'); return; }
    if (productsByName.has(normalize(name))) { setError('That product already exists. Select it from the list.'); return; }
    addingProduct.current = true;
    try {
      let categoryId = overrideCategoryId === undefined ? newProductCategory : overrideCategoryId;
      const key = `${normalize(name)}|${categorySignature}`;
      if (store.categories.length && overrideCategoryId === undefined && !manualCategoryChoice.current) {
        if (suggestionsFor === key) categoryId = recommendedCategoryId;
        else {
          setSuggesting(true);
          try {
            const result = await requestSuggestions(name, categorySignature);
            const valid = result.suggestions.filter(item => store.categories.some(category => category.id === item.categoryId));
            categoryId = valid.some(item => item.categoryId === result.recommendedCategoryId) ? result.recommendedCategoryId : null;
            setCategorySuggestions(valid); setRecommendedCategoryId(categoryId); setSuggestionsFor(key); setSuggestionError('');
          } catch (cause) {
            setSuggestionError(cause instanceof Error ? cause.message : 'AI suggestions are unavailable. Choose a category manually.');
            return;
          } finally { setSuggesting(false); }
        }
      }
      const product = placeProductInCategory({ id: crypto.randomUUID(), name, categoryId, x: null, y: null }, store.categories, true);
      if (await save({ products: [...store.products, product] })) {
        suggestionGeneration.current++;
        manualCategoryChoice.current = false;
        setNewProductName(''); setNewProductCategory(null); setCategorySuggestions([]); setRecommendedCategoryId(null); setSuggestionsFor(''); setSuggestionError('');
        setSelected(null);
        setMessage(product.x === null ? `${name} added to ${categoryName(product, store.categories)}.` : `${name} added at the center of ${categoryName(product, store.categories)}.`);
      }
    } finally { addingProduct.current = false; }
  }
  async function addCategory() {
    if (!store) return;
    const name = newCategoryName.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 100 || normalize(name) === 'uncategorized') { setError('Enter a category name of up to 100 characters.'); return; }
    if (store.categories.some(category => normalize(category.name) === normalize(name))) { setError('That category already exists.'); return; }
    const category: Category = { id: crypto.randomUUID(), name, area: null };
    if (await save({ categories: [...store.categories, category] })) { setNewCategoryName(''); selectCategory(category); }
  }
  async function updateProduct() {
    if (!store || !editingProduct) return;
    const name = editingProduct.name.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 100 || store.products.some(item => item.id !== editingProduct.id && normalize(item.name) === normalize(name))) { setError('Enter a unique product name of up to 100 characters.'); return; }
    const original = store.products.find(item => item.id === editingProduct.id);
    if (!original) return;
    const shoppingList = store.shoppingList.map(item => normalize(item) === normalize(original.name) ? name : item);
    const updated = placeProductInCategory({ ...editingProduct, name }, store.categories, editingProduct.categoryId !== original.categoryId);
    if (await save({ products: store.products.map(item => item.id === editingProduct.id ? updated : item), shoppingList })) {
      setEditingProduct(null); setListText(shoppingList.join('\n'));
    }
  }
  async function updateCategory() {
    if (!store || !editingCategory) return;
    const name = editingCategory.name.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 100 || normalize(name) === 'uncategorized' || store.categories.some(item => item.id !== editingCategory.id && normalize(item.name) === normalize(name))) { setError('Enter a unique category name of up to 100 characters.'); return; }
    if (await save({ categories: store.categories.map(item => item.id === editingCategory.id ? { ...editingCategory, name } : item) })) setEditingCategory(null);
  }
  async function deleteProduct() {
    if (!store || !deleteProductTarget) return;
    if (await save({ products: store.products.filter(item => item.id !== deleteProductTarget.id) })) { setSelected(null); setDeleteProductTarget(null); }
  }
  async function deleteCategory() {
    if (!store || !deleteCategoryTarget) return;
    if (await save({ categories: store.categories.filter(item => item.id !== deleteCategoryTarget.id), products: store.products.map(item => item.categoryId === deleteCategoryTarget.id ? { ...item, categoryId: null } : item) })) {
      setSelected(null); setDeleteCategoryTarget(null);
      if (newProductCategory === deleteCategoryTarget.id) setNewProductCategory(null);
    }
  }
  async function uploadFile(file: File) {
    if (!store) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('Choose a PNG, JPG or WebP image up to 10 MB.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();
      if (width < 32 || height < 32 || width > 10000 || height > 10000) throw new Error('Choose an image between 32 and 10,000 pixels on each side.');
      const form = new FormData(); form.append('image', file); form.append('width', String(width)); form.append('height', String(height)); form.append('revision', String(store.revision));
      const response = await fetch('/api/map', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not upload map.');
      setStore(data); setSelected(null); setView('map'); setMessage('Map saved. Product and category locations can now be placed.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not upload map.'); }
    finally { setBusy(false); setReplaceFile(null); if (fileInput.current) fileInput.current.value = ''; }
  }
  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (store?.map) setReplaceFile(file); else void uploadFile(file);
  }

  const mapPanel = <section className="map-panel">
    <div className="panel-top"><h2>Your store map</h2><div className="map-toolbar">
      {store?.map && <span className="pill">{markers.length + areas.length} location{markers.length + areas.length === 1 ? '' : 's'}</span>}
      <button className="secondary" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={15}/>{store?.map ? 'Replace map' : 'Upload map'}</button>
    </div></div>
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseFile} hidden />
    {store?.map ? <>
      <div className="map-stage"><div className={`map-image-wrap ${selected && (selected.kind !== 'category' || editingArea) ? 'placing' : ''} ${editingArea ? 'drawing-area' : ''}`} style={{ width: `min(100%, ${store.map.width}px)` }}
        onClick={placeOnMap} onPointerDown={areaPointerDown} onPointerMove={areaPointerMove} onPointerUp={areaPointerUp}
        onPointerCancel={() => { if (areaDrag.current) setDraftArea(areaBeforeDrag.current); areaDrag.current = null; areaBeforeDrag.current = null; }}
        role={selected && (selected.kind !== 'category' || editingArea) ? 'button' : undefined} aria-label={selected ? selected.kind === 'category' ? editingArea ? `Move or resize ${activeLabel} area. Use arrow keys to move, Shift and arrows to resize, Enter to save.` : undefined : `Place ${activeLabel} on map. Use arrow keys to move and Enter to place.` : undefined}
        tabIndex={selected && (selected.kind !== 'category' || editingArea) ? 0 : undefined} onKeyDown={mapKeyDown}>
        <img src={mapUrl} alt="Uploaded store drawing" draggable={false}/>
        {areas.map((overlay, index) => { const hue = [265, 195, 35, 340, 125, 20][index % 6]; return <div key={overlay.key} className="area-overlay" title={overlay.label}
          style={{ left: `${overlay.area.x * 100}%`, top: `${overlay.area.y * 100}%`, width: `${overlay.area.width * 100}%`, height: `${overlay.area.height * 100}%`, borderColor: `hsl(${hue} 68% 43%)`, backgroundColor: `hsl(${hue} 75% 50% / .18)` }}>
          <span className="area-label">{overlay.label}</span>
        </div>; })}
        {editingArea && draftArea && <div className="area-draft" style={{ left: `${draftArea.x * 100}%`, top: `${draftArea.y * 100}%`, width: `${draftArea.width * 100}%`, height: `${draftArea.height * 100}%` }} aria-hidden="true">
          {['nw','n','ne','e','se','s','sw','w'].map(handle => <span key={handle} className={`resize-handle handle-${handle}`} />)}
        </div>}
        {markers.map(marker => <button key={marker.key} className={`marker ${marker.kind === 'shopping' ? 'shopping-marker' : ''} ${selected?.kind === marker.selection.kind && selected?.id === marker.selection.id ? 'selected' : ''}`}
          style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }} title={marker.label} aria-label={`${marker.label} location`}
          onClick={event => { event.stopPropagation(); selectMarker(marker); }}>
          <span className="marker-glyph">{marker.kind === 'shopping' ? marker.count : <MapPin size={13}/>}</span>
          <span className="marker-label">{marker.label}</span>
        </button>)}
        {selected && selected.kind !== 'category' && <span className="keyboard-marker" style={{ left: `${keyboardPoint.x * 100}%`, top: `${keyboardPoint.y * 100}%` }} aria-hidden="true">+</span>}
      </div></div>
      <div className="map-bottom"><span>{editingArea ? draftArea && !redrawArea ? `Drag inside ${activeLabel} to move, or drag an edge to resize. Press Enter to save` : `Drag to draw ${activeLabel}, then press Enter to save` : selected?.kind === 'category' ? `Viewing ${activeLabel}. Click Edit to change its area` : selected ? `Click to place ${activeLabel}, or use arrow keys and Enter` : view === 'shopping' ? 'Showing your shopping list' : view === 'categories' ? 'Showing category areas' : 'Showing products and category areas'}</span>
        <div className="legend"><span><i className="swatch"/>Shelves</span><span><i className="swatch white"/>Walkways</span></div>
      </div>
    </> : <div className="empty-map"><Upload size={34}/><h2>Bring your store into view</h2><p>Upload your drawing to start placing products and categories.</p><button className="primary" onClick={() => fileInput.current?.click()} disabled={busy}>Choose a store image</button><small>PNG, JPG or WebP · up to 10 MB</small></div>}
  </section>;

  return <main className="app-shell">
    <header><a className="brand" href="/"><span className="brand-icon"><MapPin size={24}/></span>aisle<span className="brand-period">.</span></a><span className="header-note">Your store, remembered.</span></header>
    <section className="page-heading"><div><span className="eyebrow">YOUR SHOPPING COMPANION</span><h1>A place for everything.</h1><p>Your store map and the things you came for, together.</p></div><span className="store-badge"><MapPin size={16}/> One store. All your essentials.</span></section>
    {error && <div className="notice error" role="alert">{error} <button className="icon-button" onClick={() => { setError(''); void load(); }} aria-label="Reload store"><RotateCcw size={16}/></button></div>}
    {message && !error && <div className="notice" role="status">{message}</div>}
    {!store ? <div className="loading">Loading your store…</div> : <Tabs value={view} onValueChange={value => { setView(value as View); setSelected(null); setEditingAreaId(null); setDraftArea(null); setRedrawArea(false); setMessage(''); }}>
      <TabsList className="navigation"><TabsTrigger value="shopping"><ShoppingBasket/>Shopping list</TabsTrigger><TabsTrigger value="products"><MapPin/>Products</TabsTrigger><TabsTrigger value="categories"><Layers/>Categories</TabsTrigger><TabsTrigger value="map"><Upload/>Store map</TabsTrigger></TabsList>
      <TabsContent value="shopping"><div className="workspace"><aside className="panel">
        <span className="eyebrow">01 / YOUR TRIP</span><h2>Shopping list</h2><p>Paste one product per line. Items appear as points or inside their category areas on the map.</p>
        <label className="field-label" htmlFor="shopping-list">What do you need?</label><textarea id="shopping-list" value={listText} onChange={event => setListText(event.target.value)} placeholder={'Milk\nBread\nCoffee'} />
        <button className="primary wide" onClick={submitList} disabled={busy}>Show on map</button>
        {selected?.kind === 'missing' && <div className="assignment-box"><label className="field-label">Category for {selected.id}</label><CategoryPicker categories={store.categories} value={newProductCategory} onChange={setNewProductCategory} label={`Category for ${selected.id}`} /></div>}
        {store.shoppingList.length > 0 && <>
          <div className="list-heading">On your map · {known.length}</div><div className="item-list">
            {known.map((name, index) => { const product = productsByName.get(normalize(name))!; const location = productLocation(product, store.categories); return <div className={`item ${selected?.id === product.id ? 'active' : ''} ${done.includes(normalize(name)) ? 'done' : ''}`} key={normalize(name)}>
              <button className="number" onClick={() => setDone(previous => previous.includes(normalize(name)) ? previous.filter(item => item !== normalize(name)) : [...previous, normalize(name)])} aria-label={`Mark ${name} ${done.includes(normalize(name)) ? 'not collected' : 'collected'}`}>{done.includes(normalize(name)) ? <Check size={14}/> : index + 1}</button>
              <button className="item-name" onClick={() => selectProduct(product)}>{name}<small>{location?.source === 'category' ? `Via ${categoryName(product, store.categories)}` : categoryName(product, store.categories)}</small></button>
            </div>; })}{known.length === 0 && <p className="muted">No placed products yet.</p>}
          </div>
          <div className="list-heading">Location unknown · {unknown.length}</div><div className="item-list">
            {unknown.map((name, index) => <div className={`item ${selected?.id === (productsByName.get(normalize(name))?.id ?? name) ? 'active' : ''}`} key={normalize(name)}><span className="number unknown-number">{index + 1}</span><button className="item-name" onClick={() => selectMissing(name)}>{name}<small>Tap to place on the map</small></button></div>)}
            {unknown.length === 0 && <p className="muted">Every item has a place.</p>}
          </div>
        </>}
      </aside>{mapPanel}</div></TabsContent>
      <TabsContent value="products"><div className="workspace"><aside className="panel">
        <span className="eyebrow">02 / PRODUCT LIBRARY</span><h2>Products</h2><p>AI suggests categories you have already created. A new product starts at the center of its category area.</p>
        <label className="field-label" htmlFor="product-name">Add a product</label><div className="row"><input id="product-name" value={newProductName} onChange={event => {
          suggestionGeneration.current++;
          manualCategoryChoice.current = false;
          setNewProductName(event.target.value); setNewProductCategory(null); setCategorySuggestions([]); setRecommendedCategoryId(null); setSuggestionsFor(''); setSuggestionError(''); setSuggesting(false);
        }} placeholder="e.g. Olive oil" onKeyDown={event => { if (event.key === 'Enter') void addProduct(); }}/><button className="primary" onClick={() => void addProduct()} disabled={busy || suggesting} aria-label="Add product"><Plus size={18}/></button></div>
        <label className="field-label">Category</label><CategoryPicker categories={store.categories} value={newProductCategory} onChange={id => { manualCategoryChoice.current = true; setNewProductCategory(id); }} label="Category for new product" />
        {newProductName.trim().length >= 2 && store.categories.length > 0 && <div className="suggestions" aria-live="polite">
          {suggesting ? <span className="muted">Finding category suggestions…</span>
            : suggestionError ? <><span className="muted">{suggestionError} Select a category above, or add without one.</span><div className="editor-actions"><button className="secondary" onClick={() => void addProduct(null)} disabled={busy}>Add Uncategorized</button></div></>
              : suggestionsFor === `${normalize(newProductName)}|${categorySignature}` ? categorySuggestions.length
                ? <><span className="muted">Top category matches · model probability</span><div className="editor-actions">{categorySuggestions.map(({ categoryId, percentage }, index) => {
                    const category = store.categories.find(item => item.id === categoryId);
                    return category && <button key={categoryId} className={`secondary ${newProductCategory === categoryId ? 'suggestion-selected' : ''}`} onClick={() => { manualCategoryChoice.current = true; setNewProductCategory(categoryId); }}>{index + 1}. {category.name} · {percentage}%</button>;
                  })}</div>{!recommendedCategoryId && <span className="muted">No clear match; choose a category or keep Uncategorized.</span>}</>
                : <span className="muted">No clear category match. Choose one above or keep Uncategorized.</span>
                : <span className="muted">AI will suggest from your saved categories.</span>}
        </div>}
        <label className="field-label" htmlFor="product-search">Find a product</label><input id="product-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search products"/>
        <div className="list-heading">Saved products · {store.products.length}</div><div className="item-list">
          {visibleProducts.map(product => { const location = productLocation(product, store.categories); return <div className={`item ${selected?.kind === 'product' && selected.id === product.id ? 'active' : ''}`} key={product.id}>
            <span className={`number ${!location ? 'unknown-number' : ''}`}><MapPin size={15}/></span><button className="item-name" onClick={() => selectProduct(product)}>{product.name}<small>{categoryName(product, store.categories)} · {!location ? 'Needs a location' : location.source === 'category' ? 'In category area' : 'Own map point'}</small></button>
            <button className="icon-button" aria-label={`Edit ${product.name}`} title="Edit" onClick={() => setEditingProduct({...product})}><Pencil size={16}/></button><button className="icon-button" aria-label={`Delete ${product.name}`} title="Delete" onClick={() => setDeleteProductTarget(product)}><Trash2 size={16}/></button>
          </div>; })}{visibleProducts.length === 0 && <p className="muted">{store.products.length ? 'No matching products.' : 'Add your first product above.'}</p>}
        </div>
      </aside>{mapPanel}</div></TabsContent>
      <TabsContent value="categories"><div className="workspace"><aside className="panel">
        <span className="eyebrow">03 / STORE SECTIONS</span><h2>Categories</h2><p>Click a category to view it, or its Edit button to draw and reshape its area. Product pins move proportionally when you save.</p>
        <label className="field-label" htmlFor="category-name">Add a category</label><div className="row"><input id="category-name" value={newCategoryName} onChange={event => setNewCategoryName(event.target.value)} placeholder="e.g. Dairy" onKeyDown={event => { if (event.key === 'Enter') void addCategory(); }}/><button className="primary" onClick={() => void addCategory()} disabled={busy} aria-label="Add category"><Plus size={18}/></button></div>
        <div className="list-heading">Your categories · {store.categories.length}</div><div className="item-list">
          {visibleCategories.map(category => <div className={`item ${selected?.kind === 'category' && selected.id === category.id ? 'active' : ''}`} key={category.id}>
            <span className={`number ${category.area === null ? 'unknown-number' : ''}`}><Layers size={15}/></span><button className="item-name" onClick={() => selectCategory(category)}>{category.name}<small>{store.products.filter(product => product.categoryId === category.id).length} products · {category.area === null ? 'Draw an area' : 'Area drawn'}</small></button>
            <button className="icon-button" aria-label={`Edit ${category.name} area`} title="Edit area" onClick={() => editCategoryArea(category)}><Pencil size={16}/></button><button className="icon-button" aria-label={`Delete ${category.name}`} title="Delete" onClick={() => setDeleteCategoryTarget(category)}><Trash2 size={16}/></button>
          </div>)}{visibleCategories.length === 0 && <p className="muted">Add your first category above.</p>}
        </div>
        {selected?.kind === 'category' && activeCategory && <div className="instruction">
          <b>{editingArea ? `Editing ${activeCategory.name}` : `Viewing ${activeCategory.name}`}</b>
          <p>{editingArea ? draftArea ? 'Drag inside to move the area or drag a square to resize it. Changes are only a preview until you save.' : 'Drag on the map to draw an area.' : 'Use the Edit button beside this category to change its area.'}</p>
          <div className="editor-actions">
            {editingArea && <>
              {draftArea && <button className="secondary" onClick={() => { setDraftArea(null); setRedrawArea(true); setMessage(`Drag anywhere on the map to redraw ${activeCategory.name}.`); }} disabled={busy}>Draw new area</button>}
              <button className="primary" onClick={() => { if (draftArea) void saveCategoryArea(draftArea); }} disabled={busy || !draftArea}>Save changes</button>
              <button className="secondary" onClick={cancelCategoryArea} disabled={busy}>Cancel</button>
            </>}
            <button className="secondary" onClick={() => setEditingCategory({...activeCategory})} disabled={busy}>Rename</button>
          </div>
        </div>}
      </aside>{mapPanel}</div></TabsContent>
      <TabsContent value="map"><div className="workspace"><aside className="panel"><span className="eyebrow">04 / STORE MAP</span><h2>Start with your store.</h2><p>Draw your store in Paint, then upload it here. Shelves in black, walkways in white.</p><div className="instruction"><b>Keep it simple</b><p>A rough drawing is enough. Click to place a product point; drag to draw a category area.</p></div>{store.map && <p className="upload-note">Open <b>Products</b> or <b>Categories</b>, select one, then mark its place on the map.</p>}</aside>{mapPanel}</div></TabsContent>
    </Tabs>}
    <AlertDialog open={!!replaceFile} onOpenChange={open => { if (!open) { setReplaceFile(null); if (fileInput.current) fileInput.current.value = ''; } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Replace the store map?</AlertDialogTitle><AlertDialogDescription>Product and category names, assignments, and your shopping list will stay. Product points and category areas will be cleared because they may not fit the new drawing.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (replaceFile) void uploadFile(replaceFile); }}>Replace map</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={!!deleteProductTarget} onOpenChange={open => { if (!open) setDeleteProductTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {deleteProductTarget?.name}?</AlertDialogTitle><AlertDialogDescription>This removes its saved location and category assignment. The name will remain on your shopping list, if it is there.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void deleteProduct()}>Delete product</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={!!deleteCategoryTarget} onOpenChange={open => { if (!open) setDeleteCategoryTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {deleteCategoryTarget?.name}?</AlertDialogTitle><AlertDialogDescription>Products in this category will become Uncategorized. Their individual map positions will stay.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void deleteCategory()}>Delete category</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={!!editingProduct} onOpenChange={open => { if (!open) setEditingProduct(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Edit product</AlertDialogTitle><AlertDialogDescription>Change its name or category. Changing the category moves its pin to the center of the new area.</AlertDialogDescription></AlertDialogHeader><label className="field-label" htmlFor="edit-product-name">Product name</label><input id="edit-product-name" value={editingProduct?.name ?? ''} onChange={event => setEditingProduct(current => current ? { ...current, name: event.target.value } : null)} onKeyDown={event => { if (event.key === 'Enter') void updateProduct(); }}/><label className="field-label">Category</label><CategoryPicker categories={store?.categories ?? []} value={editingProduct?.categoryId ?? null} onChange={categoryId => setEditingProduct(current => current ? { ...current, categoryId } : null)} label="Product category"/><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void updateProduct()}>Save product</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={!!editingCategory} onOpenChange={open => { if (!open) setEditingCategory(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Rename category</AlertDialogTitle><AlertDialogDescription>Its products and map area will stay.</AlertDialogDescription></AlertDialogHeader><label className="field-label" htmlFor="edit-category-name">Category name</label><input id="edit-category-name" value={editingCategory?.name ?? ''} onChange={event => setEditingCategory(current => current ? { ...current, name: event.target.value } : null)} onKeyDown={event => { if (event.key === 'Enter') void updateCategory(); }}/><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void updateCategory()}>Save category</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <footer>Made for a simpler trip to the store.</footer>
  </main>;
}
