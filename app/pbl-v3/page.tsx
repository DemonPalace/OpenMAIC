'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/hooks/use-i18n';
import { pblRequest } from '@/components/scene-renderers/pbl/v3/workspace';
export default function PBLExamples() {
  const { t } = useI18n(),
    router = useRouter(),
    id = useRef<string>('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const open = async () => {
    setBusy(true);
    setError('');
    id.current ||= `pbl-${crypto.randomUUID()}`;
    try {
      const result = await pblRequest<{ classroomId: string }>('/api/pbl/v3', {
        action: 'sample',
        id: id.current,
      });
      router.push(`/classroom/${result.classroomId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto max-w-2xl space-y-5 p-8">
      <h1 className="text-2xl font-semibold">{t('pblV3.title')}</h1>
      <p>{t('pblV3.sampleNotice')}</p>
      <button
        className="rounded border px-4 py-2 disabled:opacity-50"
        disabled={busy}
        onClick={() => void open()}
      >
        {t('pblV3.openSample')}
      </button>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
