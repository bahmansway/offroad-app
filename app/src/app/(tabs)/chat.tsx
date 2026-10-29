import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Avatar, Badge, Cell, EmptyState, ErrorState, Icon, IconTile, LargeTitleScreen, LoadingState, Section, Thumb, Txt, useTheme } from '../../components/ui';
import { photoUri } from '../../components/Rows';
import { ClanLogo } from '../../components/ClanBits';
import { useAuth } from '../../lib/auth';
import { useChat } from '../../lib/chat';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import { listTime, previewText, visibleUnread } from '../../lib/chatLogic';
import { messageText } from '../../lib/systemMessages';
import type { Conversation } from '../../lib/types';

export default function ChatTab() {
  const { t } = useI18n();
  const { user, offline } = useAuth();
  const { conversations, error, reload, status, reloadInvites } = useChat();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => { if (user) { reload(); reloadInvites(); } }, [user, reload, reloadInvites]));

  if (!user) {
    return (
      <LargeTitleScreen title={t('chat.title')}>
        {offline ? <ErrorState message={t('errors.offline')} /> : (
          <EmptyState icon="chat" title={t('chat.loginPrompt')} actionLabel={t('common.login')} onAction={() => router.push('/login')} />
        )}
        <ClansEntry />
      </LargeTitleScreen>
    );
  }

  const clanChats = (conversations ?? []).filter((c) => c.type === 'clan');
  const dms = (conversations ?? []).filter((c) => c.type === 'dm');
  const events = (conversations ?? []).filter((c) => c.type === 'event');

  return (
    <LargeTitleScreen
      title={t('chat.title')}
      onRefresh={async () => { setRefreshing(true); await Promise.all([reload(), reloadInvites()]); setRefreshing(false); }}
      refreshing={refreshing}
    >
      {status === 'offline' ? <Txt variant="footnote" tone="label2" center accessibilityLiveRegion="polite">{t('chat.offline')}</Txt> : null}
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
        <EmptyState icon="chat" title={t('chat.noChatsTitle')} text={t('chat.noChatsText')} />
      ) : null}
    </LargeTitleScreen>
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

function ConversationCell({ conv, last }: { conv: Conversation; last?: boolean }) {
  const { t } = useI18n();
  const { c } = useTheme();
  const { user } = useAuth();
  const preview = conv.lastMessage ? previewText(conv, user?.id, t('chat.you'), (m) => messageText(m, t)) : t('chat.noMessagesYet');
  const time = conv.lastMessage ? listTime(conv.lastMessage.createdAt, new Date(), t('chat.yesterday')) : '';
  const count = visibleUnread(conv);
  const unread = count > 0;
  const left = conv.type === 'clan'
    ? <ClanLogo clan={{ id: conv.clanId ?? conv.id, tag: initialsOf(conv.title), logoUrl: conv.avatarUrl }} size={52} />
    : conv.type === 'event'
      ? <Thumb seed={conv.eventId ?? conv.id} uri={photoUri(conv.avatarUrl)} icon="events" size={52} rounded={14} />
      : <Avatar uri={photoUri(conv.avatarUrl)} name={conv.title} size={52} />;
  const label = [
    conv.type === 'clan' ? `${t('chat.clanChat')}: ${conv.title}` : conv.type === 'event' ? `${t('chat.eventChat')}: ${conv.title}` : conv.title,
    preview,
    time,
    unread ? t('chat.unread', { count }) : null,
    conv.muted ? t('chat.muted') : null,
    conv.readOnly ? t('chat.readOnly') : null,
  ].filter(Boolean).join(', ');
  return (
    <Cell
      title={conv.title}
      subtitle={preview}
      left={left}
      minHeight={72}
      onPress={() => router.push(`/chat/${conv.id}`)}
      accessibilityRole="link"
      accessibilityLabel={label}
      last={last}
      chevron={false}
      right={
        <View style={{ alignItems: 'flex-end', gap: 6, alignSelf: 'stretch', justifyContent: 'center' }}>
          <Txt variant="footnote" color={unread ? c.tint : c.label2}>{time}</Txt>
          {unread ? (
            <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }}>
              <Txt variant="caption" color={c.onTint} style={{ fontWeight: '700' }}>{count > 99 ? '99+' : String(count)}</Txt>
            </View>
          ) : conv.muted ? (
            <View style={{ height: 22, justifyContent: 'center' }}><Icon name="bellOff" size={16} color={c.label2} /></View>
          ) : conv.readOnly ? (
            <View style={{ height: 22, justifyContent: 'center' }}><Icon name="lock" size={16} color={c.label2} /></View>
          ) : <View style={{ height: 22 }} />}
        </View>
      }
    />
  );
}

function initialsOf(title: string) {
  const w = title.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? Array.from(w[0]).slice(0, 2) : [Array.from(w[0])[0], Array.from(w[1])[0]]).join('').toLocaleUpperCase();
}
