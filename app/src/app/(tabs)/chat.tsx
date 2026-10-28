import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Avatar, Cell, EmptyState, ErrorState, IconTile, LargeTitleScreen, LoadingState, Section, Txt, useTheme } from '../../components/ui';
import { photoUri } from '../../components/Rows';
import { ClanLogo } from '../../components/ClanBits';
import { useAuth } from '../../lib/auth';
import { useChat } from '../../lib/chat';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import { listTime, previewText } from '../../lib/chatLogic';
import type { Conversation } from '../../lib/types';

export default function ChatTab() {
  const { t } = useI18n();
  const { user, offline } = useAuth();
  const { conversations, error, reload, status } = useChat();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => { if (user) reload(); }, [user, reload]));

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

  return (
    <LargeTitleScreen
      title={t('chat.title')}
      onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }}
      refreshing={refreshing}
    >
      {status === 'offline' ? <Txt variant="footnote" tone="label2" center accessibilityLiveRegion="polite">{t('chat.offline')}</Txt> : null}
      {clanChats.length ? (
        <Section header={t('chat.myClan')}>
          {clanChats.map((c) => <ConversationCell key={c.id} conv={c} />)}
        </Section>
      ) : null}
      <ClansEntry />
      {conversations === null && !error ? <LoadingState inline /> : null}
      {error && conversations === null ? <ErrorState message={errorMessage(error, t)} onRetry={reload} /> : null}
      {dms.length ? (
        <Section header={t('chat.messages')}>
          {dms.map((c) => <ConversationCell key={c.id} conv={c} />)}
        </Section>
      ) : conversations && !clanChats.length ? (
        <EmptyState icon="chat" title={t('chat.noChatsTitle')} text={t('chat.noChatsText')} />
      ) : null}
    </LargeTitleScreen>
  );
}

function ClansEntry() {
  const { t } = useI18n();
  return (
    <Section>
      <Cell
        title={t('chat.clans')}
        subtitle={t('chat.clansSubtitle')}
        left={<IconTile icon="profile" />}
        onPress={() => router.push('/clans')}
        accessibilityRole="link"
      />
    </Section>
  );
}

function ConversationCell({ conv, last }: { conv: Conversation; last?: boolean }) {
  const { t } = useI18n();
  const { c } = useTheme();
  const { user } = useAuth();
  const preview = conv.lastMessage ? previewText(conv, user?.id, t('chat.you')) : t('chat.noMessagesYet');
  const time = conv.lastMessage ? listTime(conv.lastMessage.createdAt, new Date(), t('chat.yesterday')) : '';
  const unread = conv.unreadCount > 0;
  const left = conv.type === 'clan'
    ? <ClanLogo clan={{ id: conv.clanId ?? conv.id, tag: initialsOf(conv.title), logoUrl: conv.avatarUrl }} size={52} />
    : <Avatar uri={photoUri(conv.avatarUrl)} name={conv.title} size={52} />;
  const label = [
    conv.type === 'clan' ? `${t('chat.clanChat')}: ${conv.title}` : conv.title,
    preview,
    time,
    unread ? t('chat.unread', { count: conv.unreadCount }) : null,
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
              <Txt variant="caption" color={c.onTint} style={{ fontWeight: '700' }}>{conv.unreadCount > 99 ? '99+' : String(conv.unreadCount)}</Txt>
            </View>
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
