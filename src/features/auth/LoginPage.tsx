import { useState, type FormEvent } from 'react';
import { Archive, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Notice } from '../../components/Feedback';

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
  const [email, setEmail] = useState(getRememberedEmail);
  const [rememberEmail, setRememberEmail] = useState(() => Boolean(getRememberedEmail()));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    const normalizedEmail = email.trim();
    setRememberedEmail(rememberEmail ? normalizedEmail : null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (signInError) setError(signInError.message);
    setBusy(false);
  }

  return (
    <div className="auth-screen">
      <div className="auth-visual"><div className="auth-visual-grain" /><div className="auth-visual-content"><div className="brand brand-on-dark"><span className="brand-mark"><Archive size={21} /></span><span className="brand-name">canteen<span>daily operations</span></span></div><div className="auth-quote"><span className="auth-kicker">A calmer kitchen starts here</span><h1>Good food.<br /><em>Less waste.</em><br />One simple system.</h1><p>Small daily details add up to something good.</p></div><div className="auth-visual-footer"><span>PROUDLY BUILT FOR THE PEOPLE WHO FEED US</span><span>CHIANG MAI · THAILAND</span></div></div></div>
      <div className="auth-panel"><div className="auth-card"><span className="auth-mobile-brand"><Archive size={21} /> canteen</span><span className="auth-kicker">WELCOME BACK</span><h2>Sign in to your<br />kitchen workspace</h2><p className="auth-description">Your team’s daily operations, all in one place.</p>
        {error && <Notice>{error}</Notice>}
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>Email address<input autoComplete="username" type="email" placeholder="you@yourkitchen.com" value={email} onChange={(event) => { const value = event.target.value; setEmail(value); if (rememberEmail) setRememberedEmail(value.trim() || null); }} required /></label>
          <label>Password<span className="password-field"><input autoComplete="current-password" type={showPassword ? 'text' : 'password'} placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} /><button type="button" className="icon-button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
          <label className="auth-remember-row"><input type="checkbox" checked={rememberEmail} onChange={(event) => { const checked = event.target.checked; setRememberEmail(checked); if (checked) setRememberedEmail(email.trim() || null); else setRememberedEmail(null); }} /><span>Remember email on this device</span></label>
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Signing you in…' : 'Sign in'}<span><LockKeyhole size={16} /></span></button>
        </form>
        <p className="auth-footnote">Your account is managed by your canteen administrator.</p>
      </div><div className="auth-panel-footer">SECURE STAFF ACCESS <span /> GOOD FOOD. LESS WASTE.</div></div>
    </div>
  );
}
