import { Languages } from 'lucide-react';
import { useI18n } from '../lib/i18n';

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, t } = useI18n();
  const next = language === 'en' ? 'th' : 'en';
  return <button type="button" className={`language-toggle${compact ? ' compact' : ''}`} onClick={() => setLanguage(next)} aria-label={`${t('Switch language')}: ${next === 'th' ? t('Thai') : t('English')}`} title={next === 'th' ? t('Thai') : t('English')}>
    <Languages size={15} /><span>{language === 'en' ? 'EN' : 'ไทย'}</span>
  </button>;
}
