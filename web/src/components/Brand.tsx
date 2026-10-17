import { useApp } from '../lib/context';

/** Marca da Gisa: ícone da marmita + nome na letra da logo (+ slogan no menu do computador). */
export default function Brand({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { settings } = useApp();
  const name = settings?.establishment.name || 'Gisa Agustoni Gastronomia';
  if (size === 'sm') return (
    <div className="flex min-w-0 items-center gap-2.5 text-logo-ink">
      <img src="/marca.png" alt="" className="h-9 w-9 shrink-0 rounded-full ring-2 ring-logo-ink/20" />
      <div className="truncate font-display text-xl leading-none">{name}</div>
    </div>
  );
  return (
    <div className="flex flex-col items-center text-center text-logo-ink">
      <img src="/marca.png" alt="" className="h-14 w-14 rounded-full ring-2 ring-logo-ink/20" />
      <div className="mt-2 font-display text-[1.2rem] leading-tight">{name}</div>
      <div className="mt-1 whitespace-nowrap font-slogan text-[0.56rem] uppercase tracking-[0.14em]">O sabor de casa, todos os dias.</div>
    </div>
  );
}
