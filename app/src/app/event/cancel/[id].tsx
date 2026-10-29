import React, { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { FormError, PillButton, SheetScreen, TextField, Txt, goBack } from '../../../components/ui';
import { RequireAuth } from '../../../components/RequireAuth';
import { api } from '../../../lib/api';
import { useChat } from '../../../lib/chat';
import { useI18n } from '../../../lib/i18n';
import { eventErrorMessage } from '../../../lib/errors';
import { successFeedback } from '../../../lib/haptics';
import { EVENT_LIMITS } from '../../../lib/eventLogic';

/** Sheet: cancel an event with an optional reason (shown in the event chat). */
export default function CancelEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const chat = useChat();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.cancelEvent(id, reason.trim() || null);
      successFeedback();
      chat.reload();
      goBack(`/event/${id}`);
    } catch (e) {
      setError(eventErrorMessage(e, t));
      setBusy(false);
    }
  }

  return (
    <RequireAuth>
      <SheetScreen title={t('events.cancelTitle')} cancelLabel={t('events.keep')} onBack={() => goBack(`/event/${id}`)} contentStyle={{ paddingHorizontal: 16 }}>
        <TextField
          label={t('events.cancelReasonLabel')}
          placeholder={t('events.cancelReasonPlaceholder')}
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={EVENT_LIMITS.reasonMax}
        />
        <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20 }}>{t('events.cancelHint')}</Txt>
        <FormError message={error} />
        <PillButton title={t('events.cancelConfirm')} variant="destructive" onPress={cancel} loading={busy} />
      </SheetScreen>
    </RequireAuth>
  );
}
