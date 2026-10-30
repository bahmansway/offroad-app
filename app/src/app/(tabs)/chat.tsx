import React, { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Badge, Cell, EmptyState, ErrorState, IconButton, IconTile, LargeTitleScreen, LoadingState, SearchField, Section, Txt, useTheme } from '../../components/ui';
import { ConversationCell } from '../../components/ChatRows';
import { SearchResults } from '../../components/SearchResults';
import { useAuth } from '../../lib/auth';
import { useChat } from '../../lib/chat';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import { useSearch } from '../../lib/useSearch';

export default function ChatTab() {
  const { t } = useI18n();
  const { user, offline } = useAuth();
  const { c } = useTheme();
  const { conversations, reload, reloadInvites } = useChat();
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const search = useSearch(query, conversations);
  const searching = query.trim().length > 0;
  const searchBox = (
    <SearchField value={query} onChangeText={setQuery} placeholder={t('chat.search')} label={t('chat.searchA11y')} />
  );

  useFocusEffect(useCallback(() => { if (user) { reload(); reloadInvites(); } }, [user, reload, reloadInvites]));

  if (!user) {
    return (
      <LargeTitleScreen title={t('chat.title')}>
        {searchBox}
        {searching ? <SearchResults search={search} raw={query} /> : null}
        {offline ? <ErrorState message={t('errors.offline')} /> : (
          <EmptyState icon="chat" title={t('chat.loginPrompt')} actionLabel={t('common.login')} onAction={() => router.push('/login')} />
        )}
        <ClansEntry />
      </LargeTitleScreen>
    );
  }

  return (
    <LargeTitleScreen
      title={t('chat.title')}
      onRefresh={async () => { setRefreshing(true); await Promise.all([reload(), reloadInvites()]); setRefreshing(false); }}
      refreshing={refreshing}
      right={<IconButton icon="compose" label={t('group.newChatA11y')} color={c.tint} onPress={() => router.push('/chat/new')} />}
    >
      {searchBox}
      {searching ? <SearchResults search={search} raw={query} /> : <ChatList />}
    </LargeTitleScreen>
  );
}

function ChatList() {
  const { t } = useI18n();
  const { conversations, error, reload, status, friendRequests } = useChat();
  const clanChats = (conversations ?? []).filter((c) => c.type === 'clan');
  const dms = (conversations ?? []).filter((c) => c.type === 'dm' || c.type === 'group');
  const events = (conversations ?? []).filter((c) => c.type === 'event');
  return (
    <>
      {status === 'offline' ? <Txt variant="footnote" tone="label2" center accessibilityLiveRegion="polite">{t('chat.offline')}</Txt> : null}
      {friendRequests > 0 ? (
        <Section>
          <Cell
            title={t('friends.tabIncoming')}
            subtitle={t('tabs.friendRequests', { count: friendRequests })}
            left={<IconTile icon="invite" />}
            right={<Badge text={String(friendRequests)} />}
            chevron
            onPress={() => router.push('/friends?tab=in')}
            accessibilityRole="link"
            accessibilityLabel={`${t('friends.title')}, ${t('tabs.friendRequests', { count: friendRequests })}`}
          />
        </Section>
      ) : null}
      {clanChats.length ? (
        <Section header={t('chat.myClan')}>
          {clanChats.map((c) => <ConversationCell key={c.id} conv={c} />)}
        </Section>
      ) : null}
      <ClansEntry />
      {events.length ? (
        <Section header={t('chat.events')}>
          {events.map((c) => <ConversationCell key={c.id} conv={c} />)}
        </Section>
      ) : null}
      {conversations === null && !error ? <LoadingState inline /> : null}
      {error && conversations === null ? <ErrorState message={errorMessage(error, t)} onRetry={reload} /> : null}
      {dms.length ? (
        <Section header={t('chat.messages')}>
          {dms.map((c) => <ConversationCell key={c.id} conv={c} />)}
        </Section>
      ) : conversations && !clanChats.length && !events.length ? (
        <EmptyState illustration="mountain" title={t('chat.noChatsTitle')} text={t('chat.noChatsText')} actionLabel={t('chat.browseClans')} onAction={() => router.push('/clans')} />
      ) : null}
    </>
  );
}

function ClansEntry() {
  const { t } = useI18n();
  const { invites } = useChat();
  const n = invites?.length ?? 0;
  return (
    <Section>
      <Cell
        title={t('chat.clans')}
        subtitle={n ? t('chat.invitesWaiting', { count: n }) : t('chat.clansSubtitle')}
        left={<IconTile icon="people" />}
        right={n ? <Badge text={String(n)} /> : undefined}
        chevron
        onPress={() => router.push('/clans')}
        accessibilityRole="link"
        accessibilityLabel={[t('chat.clans'), n ? t('chat.invitesWaiting', { count: n }) : t('chat.clansSubtitle')].join(', ')}
      />
    </Section>
  );
}
