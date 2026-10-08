import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, Copy, PackagePlus, Plus } from 'lucide-react';
import { addCalendarDays, businessDateNow } from '../../lib/dates';
import { formatDate, formatFoodVariant, formatQuantity } from '../../lib/format';
import { requireSupabase } from '../../lib/supabase';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';

interface MenuItem { id: string; name: string; default_shelf_life_days: number; }
interface MeatOption { id: string; name: string; }
interface Batch { id: string; menu_id: string; production_date: string; quantity_produced: number; expiry_date: string; notes: string | null; menu_items: { name: string } | null; meat_options: { name: string } | null; }

export function ProductionPage() {
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [meatOptions, setMeatOptions] = useState<MeatOption[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [menuId, setMenuId] = useState('');
  const [meatOptionId, setMeatOptionId] = useState('');
  const [productionDate, setProductionDate] = useState(businessDateNow());
  const [quantity, setQuantity] = useState('');
  const [expiryDate, setExpiryDate] = useState(businessDateNow());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    setBusy(true);
    const db = requireSupabase();
    const [menuResult, meatResult, batchResult] = await Promise.all([
      db.from('menu_items').select('id, name, default_shelf_life_days').eq('active', true).is('deleted_at', null).order('name'),
      db.from('meat_options').select('id, name').eq('active', true).order('name'),
      db.from('production_batches').select('id, menu_id, production_date, quantity_produced, expiry_date, notes, menu_items(name), meat_options(name)').is('deleted_at', null).order('production_date', { ascending: false }).limit(30),
    ]);
    if (menuResult.error || meatResult.error || batchResult.error) setError(menuResult.error?.message ?? meatResult.error?.message ?? batchResult.error?.message ?? 'Could not load production.');
    const availableMenus = (menuResult.data ?? []) as MenuItem[];
    const availableMeats = (meatResult.data ?? []) as MeatOption[];
    setMenus(availableMenus);
    setMeatOptions(availableMeats);
    setBatches((batchResult.data ?? []) as unknown as Batch[]);
    setMenuId((current) => current || availableMenus[0]?.id || '');
    setMeatOptionId((current) => availableMeats.some((meat) => meat.id === current) ? current : availableMeats[0]?.id || '');
    setBusy(false);
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const menu = menus.find((item) => item.id === menuId);
    if (menu) setExpiryDate(addCalendarDays(productionDate, menu.default_shelf_life_days));
  }, [menus, menuId, productionDate]);

  async function addBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setSuccess(''); setSaving(true);
    const { error: saveError } = await requireSupabase().from('production_batches').insert({
      menu_id: menuId, meat_option_id: meatOptionId, production_date: productionDate, quantity_produced: Number(quantity), expiry_date: expiryDate, notes: notes.trim() || null,
    });
    if (saveError) setError(saveError.message);
    else { setSuccess('Production batch recorded.'); setQuantity(''); setNotes(''); await load(); }
    setSaving(false);
  }

  async function copyYesterday() {
    const yesterday = addCalendarDays(productionDate, -1);
    setError(''); setSuccess('');
    const { data, error: fetchError } = await requireSupabase().from('production_batches').select('menu_id, meat_option_id, quantity_produced').eq('production_date', yesterday).is('deleted_at', null);
    if (fetchError) { setError(fetchError.message); return; }
    const copied = (data ?? []).filter((row) => row.meat_option_id && menus.some((menu) => menu.id === row.menu_id) && meatOptions.some((meat) => meat.id === row.meat_option_id));
    if (copied.length === 0) { setError(`No production was recorded on ${formatDate(yesterday)}.`); return; }
    const { error: saveError } = await requireSupabase().from('production_batches').insert(copied.map((row) => {
      const menu = menus.find((item) => item.id === row.menu_id)!;
      return { menu_id: row.menu_id, meat_option_id: row.meat_option_id!, production_date: productionDate, quantity_produced: row.quantity_produced, expiry_date: addCalendarDays(productionDate, menu.default_shelf_life_days) };
    }));
    if (saveError) setError(saveError.message);
    else { setSuccess(`Copied ${copied.length} menu ${copied.length === 1 ? 'row' : 'rows'} into new batches for ${formatDate(productionDate)}.`); await load(); }
  }

  return <>
    <PageTitle eyebrow="FRESH FROM THE KITCHEN" title="Production" detail="Record today’s prepared food. Every entry creates its own batch." />
    {error && <Notice>{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
    <div className="workflow-grid production-grid">
      <section className="panel workflow-form-panel"><div className="panel-head"><div><span className="eyebrow">NEW BATCH</span><h2>What did you make?</h2></div><span className="form-panel-icon"><PackagePlus size={20} /></span></div>
        {menus.length === 0 && !busy ? <EmptyState title="Add a menu first" detail="Create a menu item in Manage, then record production here." /> : meatOptions.length === 0 && !busy ? <EmptyState title="Add a meat option first" detail="Add a shared option such as beef, chicken, pork, or vegan in Manage." /> : <form className="data-form" onSubmit={addBatch}>
          <div className="form-two-cols"><label>Menu<select required value={menuId} onChange={(event) => setMenuId(event.target.value)}>{menus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name}</option>)}</select></label><label>Meat option<select required value={meatOptionId} onChange={(event) => setMeatOptionId(event.target.value)}>{meatOptions.map((meat) => <option key={meat.id} value={meat.id}>{meat.name}</option>)}</select></label></div>
          <div className="form-two-cols"><label>Boxes prepared<input required type="number" min="1" step="1" inputMode="numeric" placeholder="e.g. 20" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>Made on<span className="input-icon-wrap"><input required type="date" value={productionDate} onChange={(event) => setProductionDate(event.target.value)} /><CalendarDays size={16} /></span></label></div>
          <label>Best before<input required type="date" min={productionDate} value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /><small className="field-help">Suggested from this menu’s shelf life. Change it if this batch needs a different date.</small></label>
          <label>Note <span className="optional-label">OPTIONAL</span><textarea rows={2} placeholder="Anything the next shift should know?" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <div className="form-buttons"><button className="button button-primary" disabled={saving || !menuId || !meatOptionId}><Plus size={17} /> {saving ? 'Saving batch…' : 'Record production'}</button><button type="button" className="button button-quiet" onClick={() => void copyYesterday()} disabled={!menus.length || !meatOptions.length}><Copy size={16} /> Copy yesterday</button></div>
          <p className="form-footnote"><span /> Quantities are checked against stock before any future deduction.</p>
        </form>}
      </section>
      <section className="panel production-history"><div className="panel-head"><div><span className="eyebrow">YOUR DAILY RECORD</span><h2>Recent batches</h2></div><span className="count-chip">{batches.length} BATCHES</span></div>
        {busy ? <LoadingState label="Loading batches…" /> : batches.length === 0 ? <EmptyState title="No batches recorded yet" detail="Your production history will grow with every kitchen day." /> : <div className="batch-table-wrap"><table className="data-table"><thead><tr><th>Food & batch</th><th>Made</th><th>Prepared</th><th>Best before</th></tr></thead><tbody>{batches.map((batch) => <tr key={batch.id}><td><strong>{formatFoodVariant(batch.menu_items?.name ?? 'Archived menu', batch.meat_options?.name)}</strong><small className="cell-subtle">Batch · {batch.id.slice(0, 8).toUpperCase()}</small></td><td>{formatDate(batch.production_date)}</td><td><span className="quantity-cell">{formatQuantity(batch.quantity_produced)} boxes</span></td><td>{formatDate(batch.expiry_date)}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
    <section className="workflow-tip"><span className="tip-icon"><CalendarDays size={16} /></span><span><strong>Carrying stock over?</strong> Add each day’s food as a new batch. The Stock page keeps separate expiry dates for you.</span><ArrowRight size={16} /></section>
  </>;
}
