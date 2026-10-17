import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';

export default function ThemeToggle({ withLabel }: { withLabel?: boolean }) {
  const { dark, cycle } = useTheme();
  const label = dark ? 'Mudar para tema claro' : 'Mudar para tema escuro';
  return (
    <button type="button" onClick={cycle} aria-label={withLabel ? undefined : label} title={withLabel ? undefined : label}
      className={`flex items-center gap-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 ${withLabel ? 'w-full px-3 py-2' : 'p-1.5'}`}>
      {dark ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
      {withLabel && (dark ? 'Tema claro' : 'Tema escuro')}
    </button>
  );
}
