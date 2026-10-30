import React, { useState } from 'react';
import { router } from 'expo-router';
import { EmptyState, ErrorState, FormError, LoadingState, NavScreen, PillButton, TextField } from '../../components/ui';
import { FriendPicker } from '../../components/FriendPicker';
import { RequireAuth } from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { useChat } from '../../lib/chat';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import { successFeedback } from '../../lib/haptics';
import { useAsync } from '../../lib/useAsync';
import { GROUP_MAX_PICK, GROUP_NAME_MAX, groupErrorMessage, groupNameError } from '../../lib/groupLogic';
import type { Id } from '../../lib/types';

/** "Qrup yarat": name + up to 19 friends. */
export default function NewGroupScreen() {
  return <RequireAuth><NewGroup /></RequireAuth>;
}

function NewGroup() {
  const { t } = useI18n();
  const chat = useChat();
  const friends = useAsync(() => api.friends(), []);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Id[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameErr = groupNameError(name);
  const nameMsg = tried && nameErr ? t(nameErr === 'empty' ? 'group.nameEmpty' : 'group.nameTooLong') : null;

  async function create() {
    setTried(true);
    setError(null);
    if (nameErr) return;
    if (!picked.length) return setError(t('group.pickAtLeastOne'));
    setBusy(true);
    const my = chat.session();
    try {
      const conv = await api.createGroup(name.trim(), picked);
      if (my !== chat.session()) return; // logged out / another account meanwhile
      successFeedback();
      chat.upsert(conv, my);
      router.replace(`/chat/${conv.id}`);
    } catch (e) {
      setError(groupErrorMessage(e, t, (x) => errorMessage(x, t, 'create')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <NavScreen
      title={t('group.newGroupTitle')}
      backLabel={t('chat.title')}
      fallback="/chat"
      footer={friends.data?.items.length ? (
        <PillButton title={t('group.create')} icon="people" onPress={create} loading={busy} />
      ) : null}
    >
      <TextField
        label={t('group.name')}
        placeholder={t('group.namePlaceholder')}
        value={name}
        onChangeText={setName}
        maxLength={GROUP_NAME_MAX + 10}
        error={nameMsg}
        returnKeyType="done"
      />
      <FormError message={error} />
      {friends.loading ? <LoadingState inline /> : friends.error ? (
        <ErrorState message={errorMessage(friends.error, t)} onRetry={friends.reload} />
      ) : friends.data?.items.length ? (
        <FriendPicker friends={friends.data.items} selected={picked} onChange={(ids) => { setPicked(ids); setError(null); }} max={GROUP_MAX_PICK} />
      ) : (
        <EmptyState icon="people" title={t('friends.noFriendsTitle')} text={t('group.noFriends')} actionLabel={t('friends.findDrivers')} onAction={() => router.push('/search')} />
      )}
    </NavScreen>
  );
}
