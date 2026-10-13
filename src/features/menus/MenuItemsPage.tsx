import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, UtensilsCrossed, X } from 'lucide-react';
import { PageTitle } from '../../components/PageTitle';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { useI18n } from '../../lib/i18n';
import { requireSupabase } from '../../lib/supabase';
import { parseMenuInput } from './menuValidation';
import { useAuth } from '../auth/AuthContext';

interface MenuItem { id: string; name: string; default_shelf_life_days: number; notes: string | null; }
interface MenuItemsPageProps { dialog?: boolean; onClose?: () => void; onCreated?: (menu: MenuItem) => void; }

export function MenuItemsPage({ dialog = false, onClose, onCreated }: MenuItemsPageProps) {
  const { member } = useAuth();
  const { t } = useI18n();
  const canEdit = member?.role === 'admin' || member?.role === 'front';
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [name, setName] = useState('');
  const [shelfLife, setShelfLife] = useState('3');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<MenuItem | null>(null);

  useEffect(() => {
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose?.(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape); };
  }, [dialog, onClose]);

  useEffect(() => {
    let alive = true;
    void requireSupabase().from('menu_items').select('id, name, default_shelf_life_days, notes')
      .eq('active', true).is('deleted_at', null).order('name').then(({ data, error: loadError }) => {
        if (!alive) return;
        if (loadError) setError(loadError.message);
        setMenus((data ?? []) as MenuItem[]); setBusy(false);
      });
    return () => { alive = false; };
  }, []);

  async function addMenu(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || saving || busy) return;
    setError(''); setCreated(null);
    const parsed = parseMenuInput({ name, default_shelf_life_days: shelfLife, notes });
    if (!parsed) { setError(t('Enter a menu name and a whole shelf life from 1 to 30 days. Notes can have up to 2,000 characters.')); return; }
    if (menus.some((menu) => menu.name.trim().toLowerCase() === parsed.name.toLowerCase())) {
      setError(t('This menu already exists. Choose it in Production.')); return;
    }
    setSaving(true);
    try {
      const { data, error: saveError } = await requireSupabase().from('menu_items')
        .insert({ ...parsed, notes: parsed.notes || null })
        .select('id, name, default_shelf_life_days, notes').single();
      if (saveError) {
        setError(t(saveError.code === '23505' ? 'This menu already exists. An admin can reactivate an inactive menu.' : saveError.code === '42501' ? 'Menu creation is not enabled for your account yet. Ask the admin to check the database permissions.' : saveError.message));
      } else if (data) {
        const menu = data as MenuItem;
        setMenus((current) => [...current, menu].sort((a, b) => a.name.localeCompare(b.name)));
        if (onCreated) onCreated(menu);
        else setCreated(menu);
        setName(''); setNotes('');
      }
    } catch { setError(t('Could not save the menu. Check your connection and try again.')); }
    finally { setSaving(false); }
  }

  const menuForm = <form className="data-form menu-create-form" onSubmit={addMenu}>
    <label>{t('Menu name')}<input required maxLength={100} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} placeholder={t('e.g. Hummus')} /></label>
    <label>{t('Default shelf life in days')}<input required type="number" min="1" max="30" step="1" inputMode="numeric" value={shelfLife} disabled={saving} onChange={(event) => setShelfLife(event.target.value)} /><small className="field-help">{t('Used to suggest expiry for new batches. Existing batches keep their expiry dates.')}</small></label>
    <label>{t('Note')} <span className="optional-label">{t('OPTIONAL')}</span><textarea maxLength={2000} value={notes} disabled={saving} onChange={(event) => setNotes(event.target.value)} /></label>
    <button className="button button-primary" disabled={busy || saving}><Plus size={18} />{t(saving ? 'Saving…' : 'Add a menu')}</button>
    <p className="field-help">{t('Adding a menu does not add food to stock. Record production when new food is prepared.')}</p>
  </form>;

  if (dialog && canEdit) return <div className="menu-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section className="menu-create-dialog" role="dialog" aria-modal="true" aria-labelledby="menu-dialog-title">
      <header className="menu-create-dialog-head"><div><span className="eyebrow">{t('FOOD MENU')}</span><h2 id="menu-dialog-title">{t('Add a menu')}</h2><p>{t('All meat options share the menu’s shelf life.')}</p></div><button type="button" className="icon-button" aria-label={t('Close')} onClick={onClose}><X size={18} /></button></header>
      {error && <Notice>{error}</Notice>}{created && <Notice tone="success">{t('Menu added. It is ready to use in Production.')}</Notice>}
      {busy ? <LoadingState /> : menuForm}
    </section>
  </div>;

  return <>
    <PageTitle eyebrow="FOOD MENU" title="Menu items" detail={canEdit ? 'Add menus for the team. All meat options share the menu’s shelf life.' : 'Review the available menu list. This account cannot change menu settings.'} action={canEdit ? <Link className="button button-quiet" to="/production">{t('Open production')}</Link> : undefined} />
    {error && <Notice>{error}</Notice>}
    {created && <div className="menu-created" role="status"><Notice tone="success">{t('Menu added. It is ready to use in Production.')}</Notice><Link className="button button-primary" to={'/production?menu=' + created.id}>{t('Record production')}</Link></div>}
    <div className="menu-create-layout">
      {canEdit && <section className="panel"><div className="panel-head"><h2>{t('Add a menu')}</h2><UtensilsCrossed size={20} /></div>{menuForm}</section>}
      <section className="panel"><div className="panel-head"><h2>{t('Available menus')}</h2><span className="count-chip">{menus.length}</span></div>
        {busy ? <LoadingState /> : menus.length === 0 ? <EmptyState title="No menus yet" detail={canEdit ? 'Add the first menu using the form.' : 'There are no active menus.'} /> : <ul className="menu-item-list">{menus.map((menu) => <li key={menu.id}><strong>{menu.name}</strong><span>{menu.default_shelf_life_days} {t('day shelf life')}</span>{menu.notes && <p>{menu.notes}</p>}</li>)}</ul>}
        {canEdit && <p className="field-help">{t('Contact the admin to edit, deactivate, or remove an existing menu.')}</p>}
      </section>
    </div>
  </>;
}
