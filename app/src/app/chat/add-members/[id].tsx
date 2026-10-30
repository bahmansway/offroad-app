import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { EmptyState, ErrorState, FormError, LoadingState, PillButton, SheetScreen, goBack } from '../../../components/ui';
import { FriendPicker } from '../../../components/FriendPicker';
import { RequireAuth } from '../../../components/RequireAuth';
import { api } from '../../../lib/api';
import { useChat } from '../../../lib/chat';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/errors';
import { successFeedback } from '../../../lib/haptics';
import { useAsync } from '../../../lib/useAsync';
import { addableFriends, groupErrorMessage, remainingSlots } from '../../../lib/groupLogic';
import type { Id } from '../../../lib/types';

/** Admin adds friends to a group (friends only, up to 20 members). */
export default function AddMembersScreen() {
  return <RequireAuth><AddMembers /></RequireAuth>;
}

function AddMembers() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const chat = useChat();
  const data = useAsync(async () => {
    const [f, m] = await Promise.all([api.friends(), api.conversationMembers(id)]);
    return { friends: addableFriends(f.items, m.items), slots: remainingSlots(m.items.length) };
  }, [id]);
  const [picked, setPicked] = useState<Id[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => goBack(`/chat/info/${id}`);

  async function add() {
    if (!picked.length) return setError(t('group.pickAtLeastOne'));
    setBusy(true);
    setError(null);
    try {
      const conv = await api.addGroupMembers(id, picked);
      successFeedback();
      chat.upsert(conv);
      close();
    } catch (e) {
      setError(groupErrorMessage(e, t, (x) => errorMessage(x, t)));
      data.reload();
    } finally {
      setBusy(false);
    }
  }

  const d = data.data;
  return (
    <SheetScreen
      title={t('group.addMembersTitle')}
      subtitle={d ? t('group.slotsLeft', { count: d.slots }) : undefined}
      cancelLabel={t('common.cancel')}
      onBack={close}
      footer={d?.friends.length && d.slots > 0 ? (
        <PillButton title={picked.length ? t('group.addCount', { count: picked.length }) : t('group.addMembers')} icon="invite" onPress={add} loading={busy} disabled={!picked.length} />
      ) : null}
      contentStyle={{ paddingHorizontal: 16 }}
    >
      <FormError message={error} />
      {data.loading && !d ? <LoadingState inline /> : data.error ? (
        <ErrorState message={errorMessage(data.error, t)} onRetry={data.reload} />
      ) : d && d.slots <= 0 ? (
        <EmptyState icon="people" title={t('group.errors.full')} contour={false} />
      ) : d && d.friends.length ? (
        <FriendPicker friends={d.friends} selected={picked} onChange={(ids) => { setPicked(ids); setError(null); }} max={d.slots} />
      ) : d ? (
        <EmptyState icon="people" title={t('group.noneToAdd')} actionLabel={t('friends.findDrivers')} onAction={() => router.push('/search')} contour={false} />
      ) : null}
    </SheetScreen>
  );
}
