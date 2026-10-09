import { useState, type FormEvent } from 'react';
import { Archive, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Notice } from '../../components/Feedback';
import { LanguageToggle } from '../../components/LanguageToggle';
import { useI18n } from '../../lib/i18n';

const rememberedEmailKey = 'canteen.rememberedEmail';

function getRememberedEmail(): string {
  try {
    return window.localStorage.getItem(rememberedEmailKey) ?? '';
  } catch {
    return '';
  }
}

function setRememberedEmail(value: string | null) {
  try {
    if (value) window.localStorage.setItem(rememberedEmailKey, value);
    else window.localStorage.removeItem(rememberedEmailKey);
  } catch {
    // Private browsing settings can disable local storage; sign-in still works.
  }
}

export function LoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState(getRememberedEmail);
  const [rememberEmail, setRememberEmail] = useState(() => Boolean(getRememberedEmail()));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<'sign-in' | 'request'>('sign-in');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    setSuccess('');
    const normalizedEmail = email.trim();
    if (mode === 'request') {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { data: { display_name: displayName.trim() } },
      });
      if (signUpError) setError(signUpError.message);
      else {
        if (data.session) await supabase.auth.signOut();
        setMode('sign-in');
        setSuccess('Account request created. Verify your email if prompted, then wait for a Website Admin to assign your role and activate access.');
        setRememberedEmail(normalizedEmail);
        setRememberEmail(true);
      }
    } else {
      setRememberedEmail(rememberEmail ? normalizedEmail : null);
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (signInError) setError(signInError.message);
    }
    setBusy(false);
  }

  return (
    <div className="auth-screen">
      <div className="auth-visual"><div className="auth-visual-grain" /><div className="auth-visual-content"><div className="brand brand-on-dark"><span className="brand-mark"><Archive size={21} /></span><span className="brand-name">canteen<span>{t('daily operations')}</span></span></div><div className="auth-quote"><span className="auth-kicker">{t('A calmer kitchen starts here')}</span><h1>{t('Good food.')}<br /><em>{t('Less waste.')}</em><br />{t('One simple system.')}</h1><p>{t('Small daily details add up to something good.')}</p></div><div className="auth-visual-footer"><span>{t('PROUDLY BUILT FOR THE PEOPLE WHO FEED US')}</span><span>{t('CHIANG MAI · THAILAND')}</span></div></div></div>
      <div className="auth-panel"><div className="auth-language-toggle"><LanguageToggle /></div><div className="auth-card"><span className="auth-mobile-brand"><Archive size={21} /> canteen</span><span className="auth-kicker">{t(mode === 'request' ? 'REQUEST TEAM ACCESS' : 'WELCOME BACK')}</span><h2>{mode === 'request' ? <>{t('Create a staff')}<br />{t('account request')}</> : <>{t('Sign in to your')}<br />{t('kitchen workspace')}</>}</h2><p className="auth-description">{t(mode === 'request' ? 'A Website Admin must approve and assign your role before you can use the workspace.' : 'Your team’s daily operations, all in one place.')}</p>
        {error && <Notice>{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'request' && <label>{t('Your name')}<input autoComplete="name" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>}
          <label>{t('Email address')}<input autoComplete="username" type="email" placeholder="you@yourkitchen.com" value={email} onChange={(event) => { const value = event.target.value; setEmail(value); if (rememberEmail) setRememberedEmail(value.trim() || null); }} required /></label>
          <label>{t('Password')}<span className="password-field"><input autoComplete={mode === 'request' ? 'new-password' : 'current-password'} type={showPassword ? 'text' : 'password'} placeholder={t(mode === 'request' ? 'Create a password' : 'Enter your password')} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} /><button type="button" className="icon-button" aria-label={t(showPassword ? 'Hide password' : 'Show password')} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
          {mode === 'sign-in' && <label className="auth-remember-row"><input type="checkbox" checked={rememberEmail} onChange={(event) => { const checked = event.target.checked; setRememberEmail(checked); if (checked) setRememberedEmail(email.trim() || null); else setRememberedEmail(null); }} /><span>{t('Remember email on this device')}</span></label>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? t(mode === 'request' ? 'Creating request…' : 'Signing you in…') : t(mode === 'request' ? 'Request access' : 'Sign in')}<span><LockKeyhole size={16} /></span></button>
        </form>
        <button type="button" className="auth-mode-switch" onClick={() => { setMode(mode === 'request' ? 'sign-in' : 'request'); setError(''); setSuccess(''); }}>{t(mode === 'request' ? 'Already have an account? Sign in' : 'Need an account? Request staff access')}</button>
        <p className="auth-footnote">{t('Your account is managed by your canteen administrator.')}</p>
      </div><div className="auth-panel-footer">{t('SECURE STAFF ACCESS')} <span /> {t('GOOD FOOD. LESS WASTE.')}</div></div>
    </div>
  );
}
