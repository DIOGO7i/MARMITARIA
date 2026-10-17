import { PageHeader } from '../components/ui';
import SecuritySettings from '../components/SecuritySettings';
import { AppearanceSettings } from './Settings';
import { useApp } from '../lib/context';

/** Conta do funcionário: tema do aparelho e a própria senha. As configurações do restaurante ficam com a responsável. */
export default function Account() {
  const { user } = useApp();
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Minha conta" subtitle={`${user?.name} · ${user?.email}`} />
      <AppearanceSettings />
      <SecuritySettings />
    </div>
  );
}
