import { useEffect, useState, type FormEvent } from 'react';
import { Archive, Check, Plus, ReceiptText, RotateCcw } from 'lucide-react';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { businessDateNow, formatBusinessDate } from '../../lib/dates';
import { formatBaht } from '../../lib/format';
import { attachPrivatePhotos, signPrivatePhotos } from '../../lib/photoAttachments';
import { requireSupabase } from '../../lib/supabase';
import { PhotoAttachmentsPicker } from '../../components/PhotoAttachmentsPicker';
import { DraftStatus } from '../../components/DraftStatus';
import { useAuth } from '../auth/AuthContext';
import { useLocalDraft } from '../../lib/localDrafts';
import { useI18n } from '../../lib/i18n';

interface Option { id: string; name: string; }
interface Expense { id: string; expense_date: string; amount_thb: number; notes: string | null; receipt_url: string | null; deleted_at: string | null; expense_receipt_photos?: { file_path: string }[]; photoUrls?: string[]; stores: { name: string } | null; expense_categories: { name: string } | null; }
interface ExpenseDraft { storeId: string; categoryId: string; date: string; amount: string; notes: string; }

function isExpenseDraft(value: unknown): value is ExpenseDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return ['storeId', 'categoryId', 'date', 'amount', 'notes'].every((key) => typeof draft[key] === 'string');
}

export function ExpensesPage() {
  const { member } = useAuth();
  const { t } = useI18n();
  const canEdit = member?.role === 'admin' || member?.role === 'kitchen';
  const [stores, setStores] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [storeId, setStoreId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(businessDateNow());
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [receipts, setReceipts] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStoreId, setEditStoreId] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editDate, setEditDate] = useState(businessDateNow());
  const [editAmount, setEditAmount] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editReceipts, setEditReceipts] = useState<File[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const draftKey = `canteen.draft.expense:${member?.user_id ?? 'local'}`;
  const { status: draftStatus, clearDraft } = useLocalDraft<ExpenseDraft>(draftKey, { storeId, categoryId, date, amount, notes }, (stored) => {
    if (!isExpenseDraft(stored)) return;
    setStoreId(stored.storeId); setCategoryId(stored.categoryId); setDate(stored.date); setAmount(stored.amount); setNotes(stored.notes);
  }, (value) => Boolean(value.amount.trim() || value.notes.trim()));

  async function load() {
    setBusy(true);
    const db = requireSupabase();
    const [storeResult, categoryResult, expenseResult] = await Promise.all([
      db.from('stores').select('id, name').eq('active', true).is('deleted_at', null).order('name'),
      db.from('expense_categories').select('id, name').eq('active', true).order('name'),
      db.from('expenses').select('id, expense_date, amount_thb, notes, receipt_url, deleted_at, stores(name), expense_categories(name), expense_receipt_photos(file_path)').order('expense_date', { ascending: false }).limit(100),
    ]);
    const errorResult = storeResult.error ?? categoryResult.error ?? expenseResult.error;
    if (errorResult) setError(errorResult.message);
    const storeItems = (storeResult.data ?? []) as Option[]; const categoryItems = (categoryResult.data ?? []) as Option[];
    const records = (expenseResult.data ?? []) as unknown as Expense[];
    const pathsByRecord = records.map((expense) => [...new Set([
      ...(expense.expense_receipt_photos ?? []).map((photo) => photo.file_path),
      ...(expense.receipt_url ? [expense.receipt_url] : []),
    ])]);
    const signedUrls = await signPrivatePhotos(db, pathsByRecord.flat());
    setStores(storeItems); setCategories(categoryItems); setExpenses(records.map((expense, index) => ({ ...expense, photoUrls: pathsByRecord[index]!.map((path) => signedUrls[path]).filter(Boolean) })));
    setStoreId((current) => storeItems.some((store) => store.id === current) ? current : storeItems[0]?.id || ''); setCategoryId((current) => categoryItems.some((category) => category.id === current) ? current : categoryItems[0]?.id || '');
    setBusy(false);
  }
  useEffect(() => { void load(); }, []);

  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    const db = requireSupabase();
    const { data, error: insertError } = await db.from('expenses').insert({ expense_date: date, store_id: storeId, category_id: categoryId, amount_thb: Number(amount), notes: notes.trim() || null }).select('id').single();
    if (insertError) { setError(insertError.message); setSaving(false); return; }
    let photoError = '';
    if (receipts.length) {
      try { await attachPrivatePhotos(db, 'receipts', data.id, receipts); }
      catch (uploadError) { photoError = `Expense was saved, but its receipt photos could not be attached: ${uploadError instanceof Error ? uploadError.message : 'unknown error'}`; }
    }
    if (photoError) setError(photoError); else setSuccess(`${formatBaht(amount)} expense recorded.`);
    setAmount(''); setNotes(''); setReceipts([]); clearDraft(); await load(); setSaving(false);
  }

  async function archiveExpense(expense: Expense) {
    if (!canEdit) return;
    if (!expense.deleted_at && !window.confirm('Archive this expense? It will leave active reports and remain in the activity log.')) return;
    const { error: updateError } = await requireSupabase().from('expenses').update({ deleted_at: expense.deleted_at ? null : new Date().toISOString() }).eq('id', expense.id);
    if (updateError) setError(updateError.message); else { setError(''); setSuccess(expense.deleted_at ? 'Expense restored.' : 'Expense archived.'); await load(); }
  }

  function beginEdit(expense: Expense) {
    setEditingId(expense.id);
    setEditStoreId(stores.find((store) => store.name === expense.stores?.name)?.id ?? stores[0]?.id ?? '');
    setEditCategoryId(categories.find((category) => category.name === expense.expense_categories?.name)?.id ?? categories[0]?.id ?? '');
    setEditDate(expense.expense_date); setEditAmount(String(expense.amount_thb)); setEditNotes(expense.notes ?? ''); setEditReceipts([]);
  }

  async function saveExpenseEdit(event: FormEvent<HTMLFormElement>, expense: Expense) {
    event.preventDefault(); if (!canEdit) return;
    setError(''); setSuccess(''); setSaving(true);
    const db = requireSupabase();
    const { error: updateError } = await db.from('expenses').update({
      expense_date: editDate, store_id: editStoreId, category_id: editCategoryId,
      amount_thb: Number(editAmount), notes: editNotes.trim() || null,
    }).eq('id', expense.id);
    if (updateError) { setError(updateError.message); setSaving(false); return; }
    let photoError = '';
    if (editReceipts.length) {
      try { await attachPrivatePhotos(db, 'receipts', expense.id, editReceipts); }
      catch (uploadError) { photoError = `Expense was updated, but its new receipt photos could not be attached: ${uploadError instanceof Error ? uploadError.message : 'unknown error'}`; }
    }
    setEditingId(null); setEditReceipts([]);
    if (photoError) setError(photoError); else setSuccess('Expense updated. The before and after values are in the activity log.');
    await load(); setSaving(false);
  }

  const total = expenses.filter((item) => item.expense_date === businessDateNow() && !item.deleted_at).reduce((sum, item) => sum + Number(item.amount_thb), 0);
  const visibleExpenses = expenses.filter((item) => Boolean(item.deleted_at) === showArchived);

  return <>
    <PageTitle eyebrow="EVERY BAHT, ACCOUNTED FOR" title="Expenses" detail={canEdit ? 'Kitchen staff can record and correct expenses at any time. Front staff can review entries and receipts.' : 'Review kitchen expenses and receipt photos. This page is read-only for Front staff.'} action={<div className="total-chip"><small>RECORDED TODAY</small><strong>{formatBaht(total)}</strong></div>} />
    {error && <Notice>{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
    <div className="workflow-grid two-panel-grid">
      {canEdit && <section className="panel workflow-form-panel"><div className="panel-head"><div><span className="eyebrow">{t('NEW PURCHASE')}</span><h2>{t('Add an expense')}</h2></div><span className="form-panel-icon blue"><ReceiptText size={20} /></span></div>
        {stores.length === 0 || categories.length === 0 ? <EmptyState title="Add a store and category" detail="Set up your most common purchase sources and categories in Manage before adding expenses." /> : <form className="data-form" onSubmit={addExpense}>
          <label>{t('Store')}<select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
          <div className="form-two-cols"><label>{t('Category')}<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>{t('Date')}<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
          <label>{t('Receipt total (THB)')}<span className="money-input"><span>฿</span><input required min="0.01" step="0.01" inputMode="decimal" type="number" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} /></span></label>
          <label>{t('Note')} <span className="optional-label">{t('OPTIONAL')}</span><textarea rows={2} placeholder={t('A short note for later')} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <PhotoAttachmentsPicker files={receipts} onChange={setReceipts} label={receipts.length ? `${receipts.length} ${t('receipt photos selected')}` : t('Add receipt photos')} hint={t('Optional · private · compressed before upload')} />
          <DraftStatus status={draftStatus} photosNotSaved />
          <button className="button button-primary" disabled={saving}><Plus size={17} /> {saving ? t('Saving expense…') : t('Add expense')}</button>
        </form>}
      </section>}
      <section className={`panel${canEdit ? '' : ' expense-readonly-panel'}`}><div className="panel-head"><div><span className="eyebrow">{t('THE DAILY SPEND')}</span><h2>{t(showArchived ? 'Archived expenses' : 'Recent expenses')}</h2></div>{canEdit && <button className="button button-quiet button-small" onClick={() => setShowArchived(!showArchived)}>{showArchived ? <RotateCcw size={14} /> : <Archive size={14} />}{t(showArchived ? 'Show active' : 'Show archived')}</button>}</div>
        {busy ? <LoadingState label="Loading expenses…" /> : visibleExpenses.length === 0 ? <EmptyState title={t(showArchived ? 'Nothing archived' : 'No expenses yet')} detail={t(showArchived ? 'Archived expenses can be restored here.' : 'Your spending summary will become more useful as receipts come in.')} /> : <div className="expense-history-list">{visibleExpenses.map((expense) => <div className={`expense-history-entry${expense.deleted_at ? ' row-archived' : ''}`} key={expense.id}><div className="expense-history-row"><span className="expense-history-icon"><ReceiptText size={17} /></span><span className="expense-history-main"><strong>{t(expense.stores?.name ?? 'Other')} <small>{t(expense.expense_categories?.name ?? 'Expense')}</small></strong><span>{formatBusinessDate(expense.expense_date)}{expense.notes ? ` · ${expense.notes}` : ''}{expense.photoUrls?.length ? ` · ${expense.photoUrls.length} ${t(expense.photoUrls.length === 1 ? 'photo' : 'photos')}` : ''}</span>{Boolean(expense.photoUrls?.length) && <div className="attachment-links">{expense.photoUrls!.map((url, index) => <a href={url} key={url} target="_blank" rel="noreferrer">{t('Receipt')} {index + 1}</a>)}</div>}</span><span className="expense-history-amount">{formatBaht(expense.amount_thb)}</span>{canEdit && <div className="expense-row-actions">{!expense.deleted_at && <button className="button button-quiet button-small" onClick={() => editingId === expense.id ? setEditingId(null) : beginEdit(expense)}>{t(editingId === expense.id ? 'Cancel' : 'Edit')}</button>}<button className="icon-button" aria-label={t(expense.deleted_at ? 'Restore expense' : 'Archive expense')} title={t(expense.deleted_at ? 'Restore expense' : 'Archive expense')} onClick={() => void archiveExpense(expense)}>{expense.deleted_at ? <RotateCcw size={15} /> : <Archive size={15} />}</button></div>}</div>{editingId === expense.id && canEdit && <form className="expense-edit-form" onSubmit={(event) => void saveExpenseEdit(event, expense)}><div className="form-two-cols"><label>{t('Store')}<select required value={editStoreId} onChange={(event) => setEditStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label>{t('Category')}<select required value={editCategoryId} onChange={(event) => setEditCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div><div className="form-two-cols"><label>{t('Date')}<input type="date" max={businessDateNow()} required value={editDate} onChange={(event) => setEditDate(event.target.value)} /></label><label>{t('Amount (THB)')}<input type="number" min="0.01" step="0.01" required value={editAmount} onChange={(event) => setEditAmount(event.target.value)} /></label></div><label>{t('Note')}<textarea rows={2} maxLength={2000} value={editNotes} onChange={(event) => setEditNotes(event.target.value)} /></label><PhotoAttachmentsPicker files={editReceipts} onChange={setEditReceipts} label={editReceipts.length ? `${editReceipts.length} ${t('new receipt photos')}` : t('Add more receipt photos')} hint={t('Existing receipt photos stay attached.')} /><button className="button button-primary button-small" disabled={saving}><Check size={14} />{saving ? t('Saving…') : t('Save changes')}</button></form>}</div>)}</div>}
      </section>
    </div>
  </>;
}
