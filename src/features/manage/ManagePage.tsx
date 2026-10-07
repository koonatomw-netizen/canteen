import { useEffect, useState, type FormEvent } from 'react';
import { Archive, Check, CirclePlus, Plus, Store, Tags, UtensilsCrossed } from 'lucide-react';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { requireSupabase } from '../../lib/supabase';

type Tab = 'menus' | 'stores' | 'categories' | 'settings';
interface ManageItem { id: string; name: string; active: boolean; default_shelf_life_days?: number; notes?: string | null; }
interface Setting { key: string; value: string; }

const tabs: { key: Tab; label: string; icon: typeof Store }[] = [
  { key: 'menus', label: 'Menu items', icon: UtensilsCrossed },
  { key: 'stores', label: 'Stores', icon: Store },
  { key: 'categories', label: 'Expense categories', icon: Tags },
  { key: 'settings', label: 'Settings', icon: Archive },
];

export function ManagePage() {
  const [tab, setTab] = useState<Tab>('menus');
  const [items, setItems] = useState<ManageItem[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [name, setName] = useState('');
  const [shelfLife, setShelfLife] = useState('3');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    setBusy(true); setError('');
    const db = requireSupabase();
    if (tab === 'menus') {
      const [{ data, error: loadError }, { data: settingData, error: settingError }] = await Promise.all([
        db.from('menu_items').select('id, name, active, default_shelf_life_days, notes').is('deleted_at', null).order('name'),
        db.from('settings').select('value').eq('key', 'default_shelf_life_days').maybeSingle(),
      ]);
      if (loadError || settingError) setError((loadError ?? settingError)?.message ?? 'Could not load menu settings.');
      setItems((data ?? []) as ManageItem[]);
      if (settingData?.value && Number(settingData.value) >= 1 && Number(settingData.value) <= 30) setShelfLife(String(Number(settingData.value)));
    } else if (tab === 'stores') {
      const { data, error: loadError } = await db.from('stores').select('id, name, active').is('deleted_at', null).order('name');
      if (loadError) setError(loadError.message);
      setItems((data ?? []) as ManageItem[]);
    } else if (tab === 'categories') {
      const { data, error: loadError } = await db.from('expense_categories').select('id, name, active').order('name');
      if (loadError) setError(loadError.message);
      setItems((data ?? []) as ManageItem[]);
    } else {
      const { data, error: loadError } = await db.from('settings').select('key, value').order('key');
      if (loadError) setError(loadError.message);
      setSettings((data ?? []) as Setting[]);
    }
    setBusy(false);
  }
  useEffect(() => { void load(); }, [tab]);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    const db = requireSupabase();
    let query;
    if (tab === 'menus') query = db.from('menu_items').insert({ name: name.trim(), default_shelf_life_days: Number(shelfLife), active: true });
    else if (tab === 'stores') query = db.from('stores').insert({ name: name.trim(), active: true });
    else if (tab === 'categories') query = db.from('expense_categories').insert({ name: name.trim(), active: true });
    else { setSaving(false); return; }
    const { error: saveError } = await query;
    if (saveError) setError(saveError.message);
    else { setSuccess(`${name.trim()} added.`); setName(''); await load(); }
    setSaving(false);
  }

  async function toggleActive(item: ManageItem) {
    setError(''); setSuccess('');
    const table = tab === 'menus' ? 'menu_items' : tab === 'stores' ? 'stores' : 'expense_categories';
    const { error: updateError } = await requireSupabase().from(table).update({ active: !item.active }).eq('id', item.id);
    if (updateError) setError(updateError.message);
    else { setSuccess(`${item.name} ${item.active ? 'archived' : 'restored'}.`); await load(); }
  }

  async function saveSetting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    const edits = Object.fromEntries(new FormData(event.currentTarget).entries());
    const updates = await Promise.all(Object.entries(edits).map(([key, value]) => requireSupabase().from('settings').update({ value: String(value) }).eq('key', key)));
    const firstError = updates.find((result) => result.error)?.error;
    if (firstError) setError(firstError.message); else setSuccess('Kitchen settings saved.');
    await load(); setSaving(false);
  }

  const title = tab === 'menus' ? 'Menu items' : tab === 'stores' ? 'Stores & sources' : tab === 'categories' ? 'Expense categories' : 'Kitchen settings';

  return <>
    <PageTitle eyebrow="KEEP THE LISTS TIDY" title="Manage" detail="Set the things your team uses every day. Keep familiar names consistent." />
    <section className="panel manage-panel"><div className="manage-tabs" role="tablist" aria-label="Manage lists">{tabs.map(({ key, label, icon: Icon }) => <button role="tab" aria-selected={tab === key} key={key} className={`manage-tab${tab === key ? ' active' : ''}`} onClick={() => { setTab(key); setError(''); setSuccess(''); }}><Icon size={17} />{label}</button>)}</div>
      <div className="manage-content"><div className="panel-head"><div><span className="eyebrow">YOUR KITCHEN’S LIBRARY</span><h2>{title}</h2></div><span className="count-chip">{tab === 'settings' ? `${settings.length} SETTINGS` : `${items.length} ITEMS`}</span></div>
        {error && <Notice>{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
        {busy ? <LoadingState label="Loading your lists…" /> : tab === 'settings' ? <form className="settings-form" onSubmit={saveSetting}>{settings.map((setting) => <label key={setting.key}><span>{setting.key.replaceAll('_', ' ')}</span><input name={setting.key} defaultValue={setting.value} readOnly={['timezone', 'currency'].includes(setting.key)} /></label>)}<div className="settings-footnote">Dates use Bangkok time. Currency is shown in Thai baht.</div><button className="button button-primary" disabled={saving}><Check size={16} />{saving ? 'Saving…' : 'Save settings'}</button></form> : <>
          {items.length === 0 ? <EmptyState title={`No ${tab} yet`} detail="Add the first one below to make daily records easier for everyone." /> : <div className="manage-list">{items.map((item) => <div className="manage-row" key={item.id}><span className="manage-item-mark">{tab === 'menus' ? <UtensilsCrossed size={17} /> : tab === 'stores' ? <Store size={17} /> : <Tags size={17} />}</span><span className="manage-item-name"><strong>{item.name}</strong>{tab === 'menus' && <small>{item.default_shelf_life_days} day shelf life</small>}</span><span className={`active-label${item.active ? ' is-active' : ''}`}>{item.active ? 'ACTIVE' : 'ARCHIVED'}</span><button className={`button button-small ${item.active ? 'button-quiet' : 'button-plain-green'}`} onClick={() => void toggleActive(item)}>{item.active ? 'Archive' : 'Restore'}</button></div>)}</div>}
          <form className="inline-add-form" onSubmit={addItem}><span className="inline-add-icon"><CirclePlus size={18} /></span><label>{tab === 'menus' ? 'Menu name' : tab === 'stores' ? 'Store or source name' : 'Category name'}<input required maxLength={80} placeholder={tab === 'menus' ? 'e.g. Chicken rice' : tab === 'stores' ? 'e.g. Makro' : 'e.g. Packaging'} value={name} onChange={(event) => setName(event.target.value)} /></label>{tab === 'menus' && <label>Shelf life in days<input type="number" min="1" max="30" required value={shelfLife} onChange={(event) => setShelfLife(event.target.value)} /></label>}<button className="button button-primary" disabled={saving}><Plus size={16} />{saving ? 'Adding…' : 'Add'}</button></form>
        </>}
      </div>
    </section>
  </>;
}
