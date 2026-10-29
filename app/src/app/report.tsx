import React, { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { EmptyState, FormError, PillButton, SheetScreen, TextField, goBack } from '../components/ui';
import { RequireAuth } from '../components/RequireAuth';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { errorMessage } from '../lib/errors';
import type { ReportTarget } from '../lib/types';

const TARGETS: ReportTarget[] = ['spot', 'car', 'user', 'message', 'clan', 'event'];

export default function ReportScreen() {
  const { targetType, targetId } = useLocalSearchParams<{ targetType: string; targetId: string }>();
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = TARGETS.includes(targetType as ReportTarget) && !!targetId;

  async function send() {
    const r = reason.trim();
    if (r.length < 1 || r.length > 500) {
      setError(t('report.reasonInvalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.report({ targetType: targetType as ReportTarget, targetId, reason: r });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e, t, 'report'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RequireAuth>
      <SheetScreen title={t('report.title')} cancelLabel={t('common.cancel')} onBack={() => goBack('/')} contentStyle={{ paddingHorizontal: 16 }}>
        {!valid ? <EmptyState icon="info" title={t('common.notFound')} /> : done ? (
          <EmptyState icon="check" title={t('report.sent')} actionLabel={t('common.close')} onAction={() => goBack('/')} />
        ) : (
          <>
            <TextField
              label={t('report.reasonLabel')}
              placeholder={t('report.reasonPlaceholder')}
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={500}
            />
            <FormError message={error} />
            <PillButton title={t('report.send')} onPress={send} loading={busy} />
          </>
        )}
      </SheetScreen>
    </RequireAuth>
  );
}
