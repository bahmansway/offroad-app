import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import {
  Cell, EmptyState, ErrorState, FormError, IconTile, LoadingState, NavScreen, SearchField, Section, Txt, useTheme,
} from '../../components/ui';
import { PersonCell } from '../../components/ChatRows';
import { RequireAuth } from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { useChat } from '../../lib/chat';
import { useI18n } from '../../lib/i18n';
import { chatErrorMessage, errorMessage } from '../../lib/errors';
import { useAsync } from '../../lib/useAsync';
import { useSearch } from '../../lib/useSearch';
import type { Id, UserRef } from '../../lib/types';

/** "Yeni söhbət": pick a person (friends, or search anyone) → DM, or "Qrup yarat". */
export default function NewChatScreen() {
  return <RequireAuth><NewChat /></RequireAuth>;
}

function NewChat() {
  const { t } = useI18n();
  const { c } = useTheme();
  const chat = useChat();
  const [query, setQuery] = useState('');
  const search = useSearch(query, null);
  const friends = useAsync(() => api.friends(), []);
  const [busy, setBusy] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(u: UserRef) {
    setBusy(u.id);
    setError(null);
    try {
      const conv = await api.startDm(u.id);
      chat.upsert(conv);
      router.replace(`/chat/${conv.id}`);
    } catch (e) {
      setError(chatErrorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  const spinner = (id: Id) => (busy === id ? <ActivityIndicator color={c.label2} /> : undefined);
  const people = search.query ? search.result?.users ?? [] : null;

  return (
    <NavScreen title={t('group.newChat')} backLabel={t('chat.title')} fallback="/chat">
      <Section>
        <Cell
          title={t('group.createGroup')}
          subtitle={t('group.createGroupHint')}
          left={<IconTile icon="people" tone="stone" size={40} />}
          action
          onPress={() => router.replace('/chat/new-group')}
          minHeight={60}
        />
      </Section>
      <SearchField value={query} onChangeText={setQuery} placeholder={t('group.searchPeople')} label={t('group.searchPeople')} />
      <FormError message={error} />

      {people ? (
        <View style={{ gap: 12 }}>
          {people.length ? (
            <Section header={t('search.people')}>
              {people.map((u) => (
                <PersonCell key={u.id} user={u} isFriend={u.isFriend} onPress={() => open(u)} right={spinner(u.id)}
                  accessibilityLabel={`${t('group.pickPerson')}: ${u.displayName}`} />
              ))}
            </Section>
          ) : null}
          {search.loading && !people.length ? <LoadingState inline /> : null}
          {search.error ? <ErrorState message={errorMessage(search.error, t)} onRetry={search.retry} /> : null}
          {!search.loading && search.answered && !people.length ? (
            <Txt variant="subhead" tone="label2" center>{t('search.none', { q: search.query! })}</Txt>
          ) : null}
        </View>
      ) : query.trim() ? (
        <Txt variant="footnote" tone="label2" center>{t('search.tooShort')}</Txt>
      ) : friends.loading ? <LoadingState inline /> : friends.error ? (
        <ErrorState message={errorMessage(friends.error, t)} onRetry={friends.reload} />
      ) : friends.data?.items.length ? (
        <Section header={t('group.yourFriends')}>
          {friends.data.items.map((f) => (
            <PersonCell key={f.user.id} user={f.user} onPress={() => open(f.user)} right={spinner(f.user.id)}
              accessibilityLabel={`${t('group.pickPerson')}: ${f.user.displayName}`} />
          ))}
        </Section>
      ) : (
        <EmptyState icon="people" title={t('friends.noFriendsTitle')} text={t('group.noFriends')} contour={false} />
      )}
    </NavScreen>
  );
}
