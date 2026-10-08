import { useEffect, useState, type FormEvent } from 'react';
import { Archive, Plus, ReceiptText, RotateCcw } from 'lucide-react';
import { EmptyState, LoadingState, Notice } from '../../components/Feedback';
import { PageTitle } from '../../components/PageTitle';
import { businessDateNow, formatBusinessDate } from '../../lib/dates';
import { formatBaht } from '../../lib/format';
import { attachPrivatePhotos, signPrivatePhotos } from '../../lib/photoAttachments';
import { requireSupabase } from '../../lib/supabase';
import { PhotoAttachmentsPicker } from '../../components/PhotoAttachmentsPicker';

interface Option { id: string; name: string; }
interface Expense { id: string; expense_date: string; amount_thb: number; notes: string | null; receipt_url: string | null; deleted_at: string | null; expense_receipt_photos?: { file_path: string }[]; photoUrls?: string[]; stores: { name: string } | null; expense_categories: { name: string } | null; }

export function ExpensesPage() {
  const [stores, setStores] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [storeId, setStoreId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(businessDateNow());
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [receipts, setReceipts] = useState<File[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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
    setStoreId((current) => current || storeItems[0]?.id || ''); setCategoryId((current) => current || categoryItems[0]?.id || '');
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
    setAmount(''); setNotes(''); setReceipts([]); await load(); setSaving(false);
  }

  async function archiveExpense(expense: Expense) {
    if (!expense.deleted_at && !window.confirm('Archive this expense? It will leave active reports and remain in the activity log.')) return;
    const { error: updateError } = await requireSupabase().from('expenses').update({ deleted_at: expense.deleted_at ? null : new Date().toISOString() }).eq('id', expense.id);
    if (updateError) setError(updateError.message); else { setError(''); setSuccess(expense.deleted_at ? 'Expense restored.' : 'Expense archived.'); await load(); }
  }

  const total = expenses.filter((item) => item.expense_date === businessDateNow() && !item.deleted_at).reduce((sum, item) => sum + Number(item.amount_thb), 0);
  const visibleExpenses = expenses.filter((item) => Boolean(item.deleted_at) === showArchived);

  return <>
    <PageTitle eyebrow="EVERY BAHT, ACCOUNTED FOR" title="Expenses" detail="Keep daily purchases in one place. Attach multiple receipt photos when helpful." action={<div className="total-chip"><small>RECORDED TODAY</small><strong>{formatBaht(total)}</strong></div>} />
    {error && <Notice>{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
    <div className="workflow-grid two-panel-grid">
      <section className="panel workflow-form-panel"><div className="panel-head"><div><span className="eyebrow">NEW PURCHASE</span><h2>Add an expense</h2></div><span className="form-panel-icon blue"><ReceiptText size={20} /></span></div>
        {stores.length === 0 || categories.length === 0 ? <EmptyState title="Add a store and category" detail="Set up your most common purchase sources and categories in Manage before adding expenses." /> : <form className="data-form" onSubmit={addExpense}>
          <label>Store<select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
          <div className="form-two-cols"><label>Category<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Date<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
          <label>Receipt total (THB)<span className="money-input"><span>฿</span><input required min="0.01" step="0.01" inputMode="decimal" type="number" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} /></span></label>
          <label>Note <span className="optional-label">OPTIONAL</span><textarea rows={2} placeholder="A short note for later" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <PhotoAttachmentsPicker files={receipts} onChange={setReceipts} label={receipts.length ? `${receipts.length} receipt photos selected` : 'Add receipt photos'} hint="Optional · private · compressed before upload" />
          <button className="button button-primary" disabled={saving}><Plus size={17} /> {saving ? 'Saving expense…' : 'Add expense'}</button>
        </form>}
      </section>
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">THE DAILY SPEND</span><h2>{showArchived ? 'Archived expenses' : 'Recent expenses'}</h2></div><button className="button button-quiet button-small" onClick={() => setShowArchived(!showArchived)}>{showArchived ? <RotateCcw size={14} /> : <Archive size={14} />}{showArchived ? 'Show active' : 'Show archived'}</button></div>
        {busy ? <LoadingState label="Loading expenses…" /> : visibleExpenses.length === 0 ? <EmptyState title={showArchived ? 'Nothing archived' : 'No expenses yet'} detail={showArchived ? 'Archived expenses can be restored here.' : 'Your spending summary will become more useful as receipts come in.'} /> : <div className="expense-history-list">{visibleExpenses.map((expense) => <div className={`expense-history-row${expense.deleted_at ? ' row-archived' : ''}`} key={expense.id}><span className="expense-history-icon"><ReceiptText size={17} /></span><span className="expense-history-main"><strong>{expense.stores?.name ?? 'Other'} <small>{expense.expense_categories?.name ?? 'Expense'}</small></strong><span>{formatBusinessDate(expense.expense_date)}{expense.notes ? ` · ${expense.notes}` : ''}{expense.photoUrls?.length ? ` · ${expense.photoUrls.length} photo${expense.photoUrls.length === 1 ? '' : 's'}` : ''}</span>{Boolean(expense.photoUrls?.length) && <div className="attachment-links">{expense.photoUrls!.map((url, index) => <a href={url} key={url} target="_blank" rel="noreferrer">Receipt {index + 1}</a>)}</div>}</span><span className="expense-history-amount">{formatBaht(expense.amount_thb)}</span><button className="icon-button" aria-label={expense.deleted_at ? 'Restore expense' : 'Archive expense'} title={expense.deleted_at ? 'Restore expense' : 'Archive expense'} onClick={() => void archiveExpense(expense)}>{expense.deleted_at ? <RotateCcw size={15} /> : <Archive size={15} />}</button></div>)}</div>}
      </section>
    </div>
  </>;
}
