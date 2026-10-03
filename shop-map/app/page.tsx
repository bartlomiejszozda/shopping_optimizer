'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, ShoppingBasket, Layers, Upload, Plus, Trash2, Pencil, Check, RotateCcw } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { Product, StoreSnapshot } from '@/lib/store';

type View = 'shopping' | 'products' | 'map';
const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const parseList = (input: string) => Array.from(new Map(input.split(/\r?\n|,/).map(line => line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean).map(name => [normalize(name), name] as const)).values()).slice(0, 300);

export default function Page() {
  const [view, setView] = useState<View>('shopping');
  const [store, setStore] = useState<StoreSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [listText, setListText] = useState('');
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
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

  async function save(products: Product[], shoppingList = store?.shoppingList ?? []) {
    if (!store || busy) return false;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: store.revision, products, shoppingList }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save.');
      setStore(data);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save.'); return false; }
    finally { setBusy(false); }
  }

  const productsByName = useMemo(() => new Map((store?.products ?? []).map(product => [normalize(product.name), product])), [store]);
  const known = (store?.shoppingList ?? []).filter(name => productsByName.get(normalize(name))?.x !== null && productsByName.get(normalize(name))?.x !== undefined);
  const unknown = (store?.shoppingList ?? []).filter(name => !productsByName.get(normalize(name)) || productsByName.get(normalize(name))?.x === null);
  const visibleProducts = (store?.products ?? []).filter(product => normalize(product.name).includes(normalize(search))).sort((a,b) => a.name.localeCompare(b.name));
  const activeProduct = (store?.products ?? []).find(product => product.id === selected || normalize(product.name) === normalize(selected ?? ''));
  const shownMarkers = view === 'shopping' ? known.map(name => productsByName.get(normalize(name))!).filter(Boolean) : store?.products.filter(product => product.x !== null) ?? [];
  const mapUrl = store?.map ? `/api/map?v=${store.map.version}` : '';

  async function submitList() {
    if (!store) return;
    const items = parseList(listText);
    if (items.some(name => name.length > 100)) { setError('Product names must be 100 characters or fewer.'); return; }
    if (await save(store.products, items)) { setSelected(null); setDone([]); setMessage(`${items.length} item${items.length === 1 ? '' : 's'} on your list.`); }
  }
  async function addProduct(name: string) {
    if (!store) return;
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean || clean.length > 100) { setError('Enter a product name of up to 100 characters.'); return; }
    if (productsByName.has(normalize(clean))) { setError('That product already exists. Select it from the list.'); return; }
    const product = { id: crypto.randomUUID(), name: clean, x: null, y: null };
    if (await save([...store.products, product])) { setSelected(product.id); setNewName(''); setMessage(`Click the map to place ${clean}.`); }
  }
  async function placeOnMap(event: React.MouseEvent<HTMLDivElement>) {
    if (!store?.map || !selected || busy) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const existing = activeProduct;
    const clean = existing?.name ?? selected.trim();
    const product = existing ? { ...existing, x, y } : { id: crypto.randomUUID(), name: clean, x, y };
    const products = existing ? store.products.map(item => item.id === existing.id ? product : item) : [...store.products, product];
    if (await save(products)) { setSelected(null); setMessage(`${clean} saved on the map.`); }
  }
  async function renameProduct() {
    if (!store || !editing) return;
    const clean = editing.name.trim().replace(/\s+/g, ' ');
    if (!clean || clean.length > 100 || store.products.some(product => product.id !== editing.id && normalize(product.name) === normalize(clean))) { setError('Enter a unique product name of up to 100 characters.'); return; }
    const original = store.products.find(product => product.id === editing.id);
    if (!original) return;
    const list = store.shoppingList.map(name => normalize(name) === normalize(original.name) ? clean : name);
    if (await save(store.products.map(product => product.id === editing.id ? { ...product, name: clean } : product), list)) { setEditing(null); setListText(list.join('\n')); }
  }
  async function deleteProduct() {
    if (!store || !deleteTarget) return;
    if (await save(store.products.filter(product => product.id !== deleteTarget.id))) { if (selected === deleteTarget.id) setSelected(null); setDeleteTarget(null); }
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
      setStore(data); setSelected(null); setView('map'); setMessage('Map saved. Select a product and click where it belongs.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not upload map.'); }
    finally { setBusy(false); setReplaceFile(null); if (fileInput.current) fileInput.current.value = ''; }
  }
  function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (store?.map) setReplaceFile(file); else void uploadFile(file);
  }
  function selectProduct(product: Product) { setSelected(product.id); setMessage(product.x === null ? `Click the map to place ${product.name}.` : `Click the map to move ${product.name}.`); }
  function selectMissing(name: string) { const product = productsByName.get(normalize(name)); setSelected(product?.id ?? name); setMessage(`Click the map where you find ${name}.`); }

  const mapPanel = <section className="map-panel"><div className="panel-top"><h2>Your store map</h2><div className="map-toolbar">{store?.map && <span className="pill">{shownMarkers.length} shown</span>}<button className="secondary" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={15}/>{store?.map ? 'Replace map' : 'Upload map'}</button></div></div><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseFile} hidden />{store?.map ? <><div className="map-stage"><div className={`map-image-wrap ${selected ? 'placing' : ''}`} style={{ width: `min(100%, ${store.map.width}px)` }} onClick={placeOnMap} role={selected ? 'button' : undefined} aria-label={selected ? `Place ${activeProduct?.name ?? selected} on map` : undefined} tabIndex={selected ? 0 : undefined} onKeyDown={event => { if (selected && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setMessage('Click or tap the exact place on the map.'); } }}><img src={mapUrl} alt="Uploaded store drawing" draggable={false}/>{shownMarkers.map((product, index) => <button key={product.id} className={`marker ${selected === product.id ? 'selected' : ''}`} style={{ left: `${(product.x ?? 0) * 100}%`, top: `${(product.y ?? 0) * 100}%` }} title={product.name} aria-label={`${product.name} location`} onClick={event => { event.stopPropagation(); selectProduct(product); }}>{view === 'shopping' ? index + 1 : <MapPin size={15}/>}<span className="marker-label">{product.name}</span></button>)}</div></div><div className="map-bottom"><span>{selected ? `Click the map to place ${activeProduct?.name ?? selected}` : view === 'shopping' ? 'Showing products from your shopping list' : 'Showing all placed products'}</span><div className="legend"><span><i className="swatch"/>Shelves</span><span><i className="swatch white"/>Walkways</span></div></div></> : <div className="empty-map"><Upload size={34}/><h2>Bring your store into view</h2><p>Upload your drawing to start placing products.</p><button className="primary" onClick={() => fileInput.current?.click()} disabled={busy}>Choose a store image</button><small>PNG, JPG or WebP · up to 10 MB</small></div>}</section>;

  return <main className="app-shell"><header><a className="brand" href="/"><span className="brand-icon"><MapPin size={24}/></span>aisle<span className="brand-period">.</span></a><span className="header-note">Your store, remembered.</span></header><section className="page-heading"><div><span className="eyebrow">YOUR SHOPPING COMPANION</span><h1>A place for everything.</h1><p>Your store map and the things you came for, together.</p></div><span className="store-badge"><MapPin size={16}/> One store. All your essentials.</span></section>{error && <div className="notice error" role="alert">{error} <button className="icon-button" onClick={() => { setError(''); void load(); }} aria-label="Reload store"><RotateCcw size={16}/></button></div>}{message && !error && <div className="notice" role="status">{message}</div>}{!store ? <div className="loading">Loading your store…</div> : <Tabs value={view} onValueChange={value => { setView(value as View); setSelected(null); setMessage(''); }}><TabsList className="navigation"><TabsTrigger value="shopping"><ShoppingBasket/>Shopping list</TabsTrigger><TabsTrigger value="products"><Layers/>All products</TabsTrigger><TabsTrigger value="map"><MapPin/>Store map</TabsTrigger></TabsList>
    <TabsContent value="shopping"><div className="workspace"><aside className="panel"><span className="eyebrow">01 / YOUR TRIP</span><h2>Shopping list</h2><p>Paste one product per line. Products you have placed will appear on the map.</p><label className="field-label" htmlFor="shopping-list">What do you need?</label><textarea id="shopping-list" value={listText} onChange={event => setListText(event.target.value)} placeholder={'Milk\nBread\nCoffee'} /><button className="primary wide" onClick={submitList} disabled={busy}>Show on map</button>{store.shoppingList.length > 0 && <><div className="list-heading">On your map · {known.length}</div><div className="item-list">{known.map((name, index) => { const product = productsByName.get(normalize(name))!; return <div className={`item ${selected === product.id ? 'active' : ''} ${done.includes(normalize(name)) ? 'done' : ''}`} key={normalize(name)}><button className="number" onClick={() => setDone(previous => previous.includes(normalize(name)) ? previous.filter(item => item !== normalize(name)) : [...previous, normalize(name)])} aria-label={`Mark ${name} ${done.includes(normalize(name)) ? 'not collected' : 'collected'}`}>{done.includes(normalize(name)) ? <Check size={14}/> : index + 1}</button><button className="item-name" onClick={() => selectProduct(product)}>{name}</button></div>; })}{known.length === 0 && <p className="muted">No placed products yet.</p>}</div><div className="list-heading">Location unknown · {unknown.length}</div><div className="item-list">{unknown.map((name, index) => <div className={`item ${selected === name ? 'active' : ''}`} key={normalize(name)}><span className="number unknown-number">{index + 1}</span><button className="item-name" onClick={() => selectMissing(name)}>{name}<small>Tap to place on the map</small></button></div>)}{unknown.length === 0 && <p className="muted">Every item has a place.</p>}</div></>}</aside>{mapPanel}</div></TabsContent>
    <TabsContent value="products"><div className="workspace"><aside className="panel"><span className="eyebrow">02 / PRODUCT LIBRARY</span><h2>All products</h2><p>See everything you have saved, whether or not it is on today’s list.</p><label className="field-label" htmlFor="product-name">Add a product</label><div className="row"><input id="product-name" value={newName} onChange={event => setNewName(event.target.value)} placeholder="e.g. Olive oil" onKeyDown={event => { if (event.key === 'Enter') void addProduct(newName); }}/><button className="primary" onClick={() => void addProduct(newName)} disabled={busy} aria-label="Add product"><Plus size={18}/></button></div><label className="field-label" htmlFor="product-search">Find a product</label><input id="product-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search products"/><div className="list-heading">Saved products · {store.products.length}</div><div className="item-list">{visibleProducts.map(product => <div className={`item ${selected === product.id ? 'active' : ''}`} key={product.id}><span className={`number ${product.x === null ? 'unknown-number' : ''}`}><MapPin size={15}/></span><button className="item-name" onClick={() => selectProduct(product)}>{product.name}<small>{product.x === null ? 'Needs a location' : 'Placed on map'}</small></button><button className="icon-button" aria-label={`Rename ${product.name}`} title="Rename" onClick={() => setEditing({...product})}><Pencil size={16}/></button><button className="icon-button" aria-label={`Delete ${product.name}`} title="Delete" onClick={() => setDeleteTarget(product)}><Trash2 size={16}/></button></div>)}{visibleProducts.length === 0 && <p className="muted">{store.products.length ? 'No matching products.' : 'Add your first product above.'}</p>}</div></aside>{mapPanel}</div></TabsContent>
    <TabsContent value="map"><div className="workspace"><aside className="panel"><span className="eyebrow">03 / STORE MAP</span><h2>Start with your store.</h2><p>Draw your store in Paint, then upload it here. Shelves in black, walkways in white.</p><div className="instruction"><b>Keep it simple</b><p>A rough drawing is enough. Place products by clicking where you find them on the map.</p></div>{store.map && <p className="upload-note">To place a product, open <b>All products</b>, select it, then click its position on the map. You can move it the same way.</p>}</aside>{mapPanel}</div></TabsContent></Tabs>}
  <AlertDialog open={!!replaceFile} onOpenChange={open => { if (!open) { setReplaceFile(null); if (fileInput.current) fileInput.current.value = ''; } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Replace the store map?</AlertDialogTitle><AlertDialogDescription>Saved product names and your shopping list will stay. Product positions will be cleared because they may not fit the new drawing.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (replaceFile) void uploadFile(replaceFile); }}>Replace map</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle><AlertDialogDescription>This removes its saved location. The product will remain on your shopping list, if it is there.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void deleteProduct()}>Delete product</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  <AlertDialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Rename product</AlertDialogTitle><AlertDialogDescription>Its map location will stay the same.</AlertDialogDescription></AlertDialogHeader><label className="field-label" htmlFor="rename-product">Product name</label><input id="rename-product" value={editing?.name ?? ''} onChange={event => setEditing(current => current ? { ...current, name: event.target.value } : null)} onKeyDown={event => { if (event.key === 'Enter') void renameProduct(); }}/><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void renameProduct()}>Save name</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  <footer>Made for a simpler trip to the store.</footer></main>;
}
