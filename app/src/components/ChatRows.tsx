import React from 'react';
import { Image, View } from 'react-native';
import { router } from 'expo-router';
import { Avatar, Badge, Cell, Icon, Thumb, Txt, useTheme } from './ui';
import { photoUri } from './Rows';
import { ClanLogo } from './ClanBits';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { listTime, previewText, visibleUnread } from '../lib/chatLogic';
import { messageText } from '../lib/systemMessages';
import type { ClanSearchItem, Conversation, UserRef, UserSearchItem } from '../lib/types';

/** Group photo, or the people glyph on the `stone` tone (round, like a person). */
export function GroupAvatar({ uri, size = 52 }: { uri?: string | null; size?: number }) {
  const { c } = useTheme();
  const src = photoUri(uri);
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: c.stone, alignItems: 'center', justifyContent: 'center' }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {src ? <Image source={{ uri: src }} style={{ width: size, height: size }} resizeMode="cover" />
        : <Icon name="people" size={Math.round(size * 0.48)} color="#FFFFFF" strokeWidth={2.2} />}
    </View>
  );
}

export function initialsOf(title: string) {
  const w = title.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? Array.from(w[0]).slice(0, 2) : [Array.from(w[0])[0], Array.from(w[1])[0]]).join('').toLocaleUpperCase();
}

/** Left picture of a conversation row / chat header. */
export function ConversationPicture({ conv, size }: { conv: Conversation; size: number }) {
  if (conv.type === 'clan') return <ClanLogo clan={{ id: conv.clanId ?? conv.id, tag: initialsOf(conv.title), logoUrl: conv.avatarUrl }} size={size} />;
  if (conv.type === 'event') return <Thumb kind="event" uri={photoUri(conv.avatarUrl)} size={size} rounded={Math.round(size * 0.27)} />;
  if (conv.type === 'group') return <GroupAvatar uri={conv.avatarUrl} size={size} />;
  return <Avatar uri={photoUri(conv.avatarUrl)} name={conv.title} size={size} />;
}

export function ConversationCell({ conv, last, onPress }: { conv: Conversation; last?: boolean; onPress?: () => void }) {
  const { t } = useI18n();
  const { c } = useTheme();
  const { user } = useAuth();
  const preview = conv.lastMessage ? previewText(conv, user?.id, t('chat.you'), (m) => messageText(m, t)) : t('chat.noMessagesYet');
  const time = conv.lastMessage ? listTime(conv.lastMessage.createdAt, new Date(), t('chat.yesterday')) : '';
  const count = visibleUnread(conv);
  const unread = count > 0;
  const kindLabel = conv.type === 'clan' ? t('chat.clanChat') : conv.type === 'event' ? t('chat.eventChat') : conv.type === 'group' ? t('chat.groupChat') : null;
  const label = [
    kindLabel ? `${kindLabel}: ${conv.title}` : conv.title,
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
      left={<ConversationPicture conv={conv} size={52} />}
      minHeight={72}
      onPress={onPress ?? (() => router.push(`/chat/${conv.id}`))}
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

/** A person in search / pickers: avatar, name, city, "Dost" badge (or a custom right element). */
export function PersonCell({ user, subtitle, isFriend, onPress, right, last, checked, accessibilityLabel, accessibilityRole }: {
  user: UserRef | UserSearchItem; subtitle?: string | null; isFriend?: boolean; onPress?: () => void; right?: React.ReactNode;
  last?: boolean; checked?: boolean; accessibilityLabel?: string; accessibilityRole?: 'button' | 'link';
}) {
  const { t } = useI18n();
  const sub = subtitle ?? ('city' in user ? user.city : null) ?? undefined;
  const friendBadge = isFriend && !right ? <Badge text={t('search.friend')} tone="forest" /> : null;
  return (
    <Cell
      title={user.displayName}
      subtitle={sub || undefined}
      left={<Avatar uri={photoUri(user.avatarUrl)} name={user.displayName} size={40} />}
      right={right ?? friendBadge ?? undefined}
      onPress={onPress}
      checked={checked}
      chevron={checked === undefined && !right && !friendBadge ? undefined : false}
      last={last}
      accessibilityRole={accessibilityRole ?? (checked !== undefined ? 'button' : 'link')}
      accessibilityLabel={accessibilityLabel ?? [user.displayName, sub, isFriend ? t('search.friend') : null].filter(Boolean).join(', ')}
    />
  );
}

/** A clan in search results. */
export function ClanResultCell({ clan, last }: { clan: ClanSearchItem; last?: boolean }) {
  const { t } = useI18n();
  const meta = [`[${clan.tag}]`, clan.city, t('clan.memberCount', { count: clan.memberCount })].filter(Boolean).join(' · ');
  const badge = clan.isOpen ? t('clan.open') : t('clan.request');
  return (
    <Cell
      title={clan.name}
      subtitle={meta}
      left={<ClanLogo clan={clan} size={40} />}
      right={<Badge text={badge} tone="gray" />}
      onPress={() => router.push(`/clan/${clan.id}`)}
      accessibilityRole="link"
      accessibilityLabel={`${clan.name}, ${meta}, ${badge}`}
      last={last}
    />
  );
}
