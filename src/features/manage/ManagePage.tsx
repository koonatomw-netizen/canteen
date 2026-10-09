import { useEffect, useState, type FormEvent } from 'react';
import {
  Archive, Check, CirclePlus, Plus, ShieldCheck, Store, Tags,
  Trash2, UserRoundCog, UtensilsCrossed,
} from 'lucide-react';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { useI18n } from '../../lib/i18n';
import { requireSupabase } from '../../lib/supabase';
import { useAuth, type AppRole } from '../auth/AuthContext';
import { roleLabels } from '../auth/permissions';

type Tab = 'users' | 'menus' | 'meats' | 'stores' | 'categories' | 'waste-reasons' | 'stock-out-reasons' | 'settings';
interface ManageItem { id: string; name: string; active: boolean; default_shelf_life_days?: number; notes?: string | null; }
interface Setting { key: string; value: string; }
interface MemberRow { user_id: string; email: string | null; display_name: string; role: AppRole; active: boolean; }
interface MemberEdit { display_name?: string; role?: AppRole; active?: boolean; }

const tabs: { key: Tab; label: string; icon: typeof Store }[] = [
  { key: 'users', label: 'Users & roles', icon: UserRoundCog },
  { key: 'menus', label: 'Menu items', icon: UtensilsCrossed },
  { key: 'meats', label: 'Meat options', icon: UtensilsCrossed },
  { key: 'stores', label: 'Stores', icon: Store },
  { key: 'categories', label: 'Expense categories', icon: Tags },
  { key: 'waste-reasons', label: 'Waste reasons', icon: Trash2 },
  { key: 'stock-out-reasons', label: 'After-close reasons', icon: Archive },
  { key: 'settings', label: 'Settings', icon: ShieldCheck },
];

const listTables: Record<Exclude<Tab, 'users' | 'settings'>, string> = {
  menus: 'menu_items', meats: 'meat_options', stores: 'stores', categories: 'expense_categories',
  'waste-reasons': 'waste_reasons', 'stock-out-reasons': 'stock_out_reasons',
};

const roleOptions: AppRole[] = ['front', 'kitchen', 'manager', 'admin'];

export function ManagePage() {
  const { t } = useI18n();
  const { member } = useAuth();
  const [tab, setTab] = useState<Tab>('users');
  const [items, setItems] = useState<ManageItem[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberEdits, setMemberEdits] = useState<Record<string, MemberEdit>>({});
  const [name, setName] = useState('');
  const [shelfLife, setShelfLife] = useState('3');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editShelfLife, setEditShelfLife] = useState('3');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    setBusy(true); setError('');
    const db = requireSupabase();
    if (tab === 'users') {
      const { data, error: loadError } = await db.from('app_members').select('user_id, email, display_name, role, active').order('display_name');
      if (loadError) setError(loadError.message);
      setMembers((data ?? []) as MemberRow[]);
    } else if (tab === 'settings') {
      const { data, error: loadError } = await db.from('settings').select('key, value').order('key');
      if (loadError) setError(loadError.message);
      setSettings((data ?? []) as Setting[]);
    } else {
      const table = listTables[tab];
      const query = tab === 'menus'
        ? db.from('menu_items').select('id, name, active, default_shelf_life_days')
        : db.from(table).select('id, name, active');
      const { data, error: loadError } = await (tab === 'menus' || tab === 'stores' ? query.is('deleted_at', null) : query).order('name');
      if (loadError) setError(loadError.message);
      setItems((data ?? []) as ManageItem[]);
      if (tab === 'menus') {
        const { data: settingData, error: settingError } = await db.from('settings').select('value').eq('key', 'default_shelf_life_days').maybeSingle();
        if (settingError) setError(settingError.message);
        if (settingData?.value && Number(settingData.value) >= 1 && Number(settingData.value) <= 30) setShelfLife(String(Number(settingData.value)));
      }
    }
    setBusy(false);
  }

  useEffect(() => { void load(); }, [tab]);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    const table = listTables[tab as keyof typeof listTables];
    const db = requireSupabase();
    const result = tab === 'menus'
      ? await db.from('menu_items').insert({ name: name.trim(), default_shelf_life_days: Number(shelfLife), active: true })
      : await db.from(table).insert({ name: name.trim(), active: true });
    const saveError = result.error;
    if (saveError) setError(saveError.message);
    else { setSuccess(`${name.trim()} added${tab === 'meats' ? ' to every menu' : ''}.`); setName(''); await load(); }
    setSaving(false);
  }

  async function toggleActive(item: ManageItem) {
    setError(''); setSuccess(''); setSaving(true);
    const { error: updateError } = await requireSupabase().from(listTables[tab as keyof typeof listTables]).update({ active: !item.active }).eq('id', item.id);
    if (updateError) setError(updateError.message);
    else { setSuccess(`${item.name} ${item.active ? 'deactivated' : 'restored'}.`); await load(); }
    setSaving(false);
  }

  function beginEdit(item: ManageItem) {
    setEditingId(item.id); setEditName(item.name); setEditShelfLife(String(item.default_shelf_life_days ?? 3));
  }

  async function saveItem(item: ManageItem) {
    setError(''); setSuccess(''); setSaving(true);
    const payload = tab === 'menus'
      ? { name: editName.trim(), default_shelf_life_days: Number(editShelfLife) }
      : { name: editName.trim() };
    const { error: updateError } = await requireSupabase().from(listTables[tab as keyof typeof listTables]).update(payload).eq('id', item.id);
    if (updateError) setError(updateError.message);
    else { setSuccess(`${editName.trim()} saved.`); setEditingId(null); await load(); }
    setSaving(false);
  }

  async function removeMenu(item: ManageItem) {
    if (!window.confirm(`Permanently remove “${item.name}” from menu settings? Historical batches, stock, waste and reports will keep the original name. This cannot be undone.`)) return;
    setError(''); setSuccess(''); setSaving(true);
    const { error: removeError } = await requireSupabase().rpc('permanently_delete_menu', { p_menu_id: item.id });
    if (removeError) setError(removeError.message);
    else { setSuccess(`${item.name} removed permanently and recorded in the activity log.`); await load(); }
    setSaving(false);
  }

  function editMember(user: MemberRow, changes: MemberEdit) {
    setMemberEdits((current) => ({ ...current, [user.user_id]: { ...current[user.user_id], ...changes } }));
  }

  async function saveMember(user: MemberRow) {
    setError(''); setSuccess(''); setSaving(true);
    const edit = memberEdits[user.user_id] ?? {};
    const { error: updateError } = await requireSupabase().from('app_members').update({
      display_name: (edit.display_name ?? user.display_name).trim(),
      role: edit.role ?? user.role,
      active: edit.active ?? user.active,
    }).eq('user_id', user.user_id);
    if (updateError) setError(updateError.message);
    else {
      setSuccess(`${user.email ?? user.display_name} access updated and recorded.`);
      setMemberEdits((current) => { const next = { ...current }; delete next[user.user_id]; return next; });
      await load();
    }
    setSaving(false);
  }

  async function saveSetting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const shelfLifeValue = Number(values.default_shelf_life_days);
    if (!Number.isInteger(shelfLifeValue) || shelfLifeValue < 1 || shelfLifeValue > 30) {
      setError('Default shelf life must be a whole number from 1 to 30 days.'); setSaving(false); return;
    }
    const { error: saveError } = await requireSupabase().from('settings').update({ value: String(shelfLifeValue) }).eq('key', 'default_shelf_life_days');
    if (saveError) setError(saveError.message); else setSuccess('Default shelf life saved.');
    await load(); setSaving(false);
  }

  const title = tab === 'users' ? 'Users & permissions'
    : tab === 'menus' ? 'Menu items'
      : tab === 'meats' ? 'Meat options'
        : tab === 'stores' ? 'Stores & sources'
          : tab === 'categories' ? 'Expense categories'
            : tab === 'waste-reasons' ? 'Waste reasons'
              : tab === 'stock-out-reasons' ? 'After-close removal reasons' : 'Kitchen settings';

  return <>
    <PageTitle eyebrow="YOUR SYSTEM, YOUR RULES" title="Manage" detail="Manage accounts and update the lists your team uses, without changing code." />
    <section className="panel manage-panel"><div className="manage-tabs" role="tablist" aria-label={t('Manage settings')}>{tabs.map(({ key, label, icon: Icon }) => <button type="button" role="tab" aria-selected={tab === key} key={key} className={`manage-tab${tab === key ? ' active' : ''}`} onClick={() => { setTab(key); setError(''); setSuccess(''); }}><Icon size={17} />{t(label)}</button>)}</div>
      <div className="manage-content"><div className="panel-head"><div><span className="eyebrow">{t('WEBSITE ADMIN')}</span><h2>{t(title)}</h2></div><span className="count-chip">{busy ? t('LOADING') : tab === 'settings' ? `${settings.length} ${t('SETTINGS')}` : tab === 'users' ? `${members.length} ${t('ACCOUNTS')}` : `${items.length} ${t('ITEMS')}`}</span></div>
        {error && <Notice>{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
        {busy ? <LoadingState label="Loading your settings…" /> : tab === 'users' ? <>
          <p className="manage-help">{t('New sign-ups wait here with no app access. Choose a role and activate the account. Changes are written to the activity log.')}</p>
          {members.length === 0 ? <EmptyState title="No account requests yet" detail="Staff can request an account from the sign-in page. Their access stays off until you approve it here." /> : <div className="member-admin-list">{members.map((user) => {
            const edit = memberEdits[user.user_id] ?? {};
            const isSelf = user.user_id === member?.user_id;
            const changed = Object.keys(edit).length > 0;
            return <div className={`member-admin-row${!user.active ? ' member-pending' : ''}`} key={user.user_id}>
               <div className="member-admin-identity"><span className="member-admin-avatar">{(edit.display_name ?? user.display_name).slice(0, 1).toUpperCase()}</span><div><input className="member-name-input" aria-label={`${t('Display name for')} ${user.email ?? user.display_name}`} maxLength={80} value={edit.display_name ?? user.display_name} onChange={(event) => editMember(user, { display_name: event.target.value })} /><small>{user.email ?? t('No email on account')}{isSelf ? ` · ${t('You')}` : ''}</small></div></div>
               <label className="member-role-field">{t('Role')}<select value={edit.role ?? user.role} disabled={isSelf} onChange={(event) => editMember(user, { role: event.target.value as AppRole })}>{roleOptions.map((role) => <option key={role} value={role}>{t(roleLabels[role])}</option>)}</select></label>
               <label className="member-active-field"><input type="checkbox" checked={edit.active ?? user.active} disabled={isSelf} onChange={(event) => editMember(user, { active: event.target.checked })} /><span>{t((edit.active ?? user.active) ? 'Active' : 'Access off')}</span></label>
               <button className="button button-quiet button-small" disabled={saving || !changed} onClick={() => void saveMember(user)}><Check size={14} />{t('Save')}</button>
            </div>;
          })}</div>}
          <div className="manage-side-note"><UserRoundCog size={16} /><span>{t('Accounts are created through staff sign-up. The Website Admin controls app access and role assignment here; no service key is used in the browser.')}</span></div>
        </> : tab === 'settings' ? <form className="settings-form" onSubmit={saveSetting}>
          {settings.map((setting) => <label key={setting.key}><span>{setting.key.replaceAll('_', ' ')}</span><input name={setting.key} type={setting.key === 'default_shelf_life_days' ? 'number' : 'text'} min={setting.key === 'default_shelf_life_days' ? 1 : undefined} max={setting.key === 'default_shelf_life_days' ? 30 : undefined} defaultValue={setting.value} readOnly={['timezone', 'currency'].includes(setting.key)} required={setting.key === 'default_shelf_life_days'} /></label>)}
          <div className="settings-footnote">{t('Bangkok time and Thai baht stay fixed for consistent daily reports. Default shelf life applies to new menus; existing menu shelf lives remain separately editable.')}</div>
          <button className="button button-primary" disabled={saving}><Check size={16} />{saving ? t('Saving…') : t('Save settings')}</button>
        </form> : <>
          {tab === 'meats' && <p className="manage-help">{t('These options are shared by every menu. Each new batch picks one; its menu controls shelf life.')}</p>}
          {tab === 'waste-reasons' && <p className="manage-help">{t('Only actual discarded food belongs here. Choose “Other” with a note for details.')}</p>}
          {tab === 'stock-out-reasons' && <p className="manage-help">{t('Use these when food leaves stock after closing. They stay separate from waste totals.')}</p>}
          {items.length === 0 ? <EmptyState title="No entries yet" detail="Add the first one below to make daily records easier for everyone." /> : <div className="manage-list">{items.map((item) => <div className="manage-row" key={item.id}>
            <span className="manage-item-mark">{tab === 'menus' || tab === 'meats' ? <UtensilsCrossed size={17} /> : tab === 'stores' ? <Store size={17} /> : <Tags size={17} />}</span>
            <span className="manage-item-name">{editingId === item.id ? <input className="manage-edit-input" aria-label={`Name for ${item.name}`} value={editName} maxLength={80} onChange={(event) => setEditName(event.target.value)} /> : <strong>{item.name}</strong>}
              {tab === 'menus' && (editingId === item.id ? <label className="manage-edit-shelf">{t('Shelf life')} <input type="number" min="1" max="30" value={editShelfLife} onChange={(event) => setEditShelfLife(event.target.value)} /></label> : <small>{item.default_shelf_life_days} {t('day shelf life')}</small>)}
              {tab === 'meats' && <small>{t('Shared by every menu')}</small>}
            </span>
            <span className={`active-label${item.active ? ' is-active' : ''}`}>{t(item.active ? 'ACTIVE' : 'INACTIVE')}</span>
            {editingId === item.id ? <><button className="button button-primary button-small" onClick={() => void saveItem(item)} disabled={saving || !editName.trim()}><Check size={13} />{t('Save')}</button><button className="button button-quiet button-small" onClick={() => setEditingId(null)}>{t('Cancel')}</button></> : <button className="button button-quiet button-small" onClick={() => beginEdit(item)}>{t('Edit')}</button>}
            <button className={`button button-small ${item.active ? 'button-quiet' : 'button-plain-green'}`} onClick={() => void toggleActive(item)} disabled={saving}>{t(item.active ? 'Deactivate' : 'Restore')}</button>
            {tab === 'menus' && <button className="button button-small button-remove" onClick={() => void removeMenu(item)} disabled={saving}><Trash2 size={13} />{t('Remove')}</button>}
          </div>)}</div>}
          <form className="inline-add-form" onSubmit={addItem}><span className="inline-add-icon"><CirclePlus size={18} /></span><label>{t(tab === 'menus' ? 'Menu name' : tab === 'meats' ? 'Meat option name' : tab === 'stores' ? 'Store or source name' : tab === 'categories' ? 'Category name' : 'Reason name')}<input required maxLength={80} placeholder={t(tab === 'menus' ? 'e.g. Hummus' : tab === 'meats' ? 'e.g. Fish' : tab === 'stores' ? 'e.g. Makro' : tab === 'categories' ? 'e.g. Packaging' : tab === 'waste-reasons' ? 'e.g. Over-prepared' : 'e.g. Owner pickup')} value={name} onChange={(event) => setName(event.target.value)} /></label>{tab === 'menus' && <label>{t('Shelf life in days')}<input type="number" min="1" max="30" required value={shelfLife} onChange={(event) => setShelfLife(event.target.value)} /></label>}<button className="button button-primary" disabled={saving}><Plus size={16} />{saving ? t('Adding…') : t('Add')}</button></form>
        </>}
      </div>
    </section>
  </>;
}
