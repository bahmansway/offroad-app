import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, EmptyState, ErrorState, Icon, LoadingState, NavBar, Txt, goBack, useTheme } from '../../components/ui';
import { RequireAuth } from '../../components/RequireAuth';
import { ActionSheet, type SheetAction } from '../../components/ActionSheet';
import { ClanLogo } from '../../components/ClanBits';
import { photoUri } from '../../components/Rows';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/apiClient';
import { useAuth } from '../../lib/auth';
import { useChat } from '../../lib/chat';
import { useI18n } from '../../lib/i18n';
import { chatErrorMessage, errorMessage } from '../../lib/errors';
import { HAIRLINE, TAP, type as typeScale } from '../../lib/theme';
import { tapFeedback } from '../../lib/haptics';
import {
  buildRows, dayLabel, dropPending, formatTime, isLocal, MAX_MESSAGE, mergeLatestPage, mergeMessages, newClientId,
  oldestId, pendingMessage, setStatus, type ChatItem, type ChatRow,
} from '../../lib/chatLogic';
import type { Conversation } from '../../lib/types';

const PAGE = 50;

export default function ChatScreen() {
  return <RequireAuth><Chat /></RequireAuth>;
}

function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, d } = useI18n();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const chat = useChat();
  const { setOpen, markRead, subscribe, onCatchUp, conversations, status } = chat;

  const [conv, setConv] = useState<Conversation | null>(() => conversations?.find((x) => String(x.id) === String(id)) ?? null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [menu, setMenu] = useState<ChatItem | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const focused = useRef(false);

  const isGone = (e: unknown) => e instanceof ApiError && (e.status === 403 || e.status === 404);

  // first load: conversation header + newest page
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [cv, page] = await Promise.all([api.conversation(id), api.messages(id, { limit: PAGE })]);
      setConv(cv);
      setItems((cur) => mergeLatestPage(cur, page));
      setHasMore(page.hasMore);
      setLoaded(true);
      markRead(id);
    } catch (e) {
      if (isGone(e)) setNoAccess(true);
      else setLoadError(e);
    }
  }, [id, markRead]);

  useEffect(() => { load(); }, [load]);

  // live messages
  useEffect(() => subscribe(id, (m) => {
    setItems((cur) => mergeMessages(cur, [m]));
    if (focused.current && String(m.sender.id) !== String(user?.id)) markRead(id);
  }), [id, subscribe, markRead, user?.id]);

  // poll / reconnect: fetch the newest page
  useEffect(() => onCatchUp(async () => {
    try {
      const page = await api.messages(id, { limit: PAGE });
      setItems((cur) => mergeLatestPage(cur, page));
      if (focused.current) markRead(id);
    } catch (e) {
      if (isGone(e)) setNoAccess(true);
    }
  }), [id, onCatchUp, markRead]);

  // tell the list which chat is open (no unread bump while reading it)
  useFocusEffect(useCallback(() => {
    focused.current = true;
    setOpen(id);
    return () => {
      focused.current = false;
      setOpen(null);
    };
  }, [id, setOpen]));

  async function loadOlder() {
    const before = oldestId(itemsRef.current);
    if (!hasMore || loadingOlder || !before) return;
    setLoadingOlder(true);
    try {
      const page = await api.messages(id, { before, limit: PAGE });
      setItems((cur) => mergeMessages(cur, page.items));
      setHasMore(page.hasMore);
    } catch {
      /* stays hasMore; next scroll tries again */
    } finally {
      setLoadingOlder(false);
    }
  }

  async function deliver(clientId: string, body: string) {
    setItems((cur) => setStatus(cur, clientId, 'sending'));
    try {
      const msg = await api.sendMessage(id, body, clientId);
      setItems((cur) => mergeMessages(cur, [msg]));
      setSendError(null);
    } catch (e) {
      setItems((cur) => setStatus(cur, clientId, 'failed'));
      const kind = conv?.type ?? null;
      setSendError(chatErrorMessage(e, t, kind));
      // 404 = chat gone; 403 in a clan chat = removed from the clan (in a DM, 403 means blocked)
      if (e instanceof ApiError && (e.status === 404 || (e.status === 403 && kind === 'clan'))) setNoAccess(true);
    }
  }

  function send() {
    const body = text.trim();
    if (!body || !user) return;
    if (body.length > MAX_MESSAGE) {
      setSendError(t('chat.tooLong'));
      return;
    }
    tapFeedback();
    const clientId = newClientId();
    setItems((cur) => [...cur, pendingMessage({ conversationId: id, text: body, clientId, me: user })]);
    setText('');
    setSendError(null);
    deliver(clientId, body);
  }

  const rows = useMemo(() => buildRows(items, user?.id).reverse(), [items, user?.id]);
  const isClan = conv?.type === 'clan';
  const words = useMemo(() => ({ today: t('chat.today'), yesterday: t('chat.yesterday'), months: d.chat.months }), [t, d]);

  function openHeader() {
    if (!conv) return;
    if (conv.type === 'clan' && conv.clanId) router.push(`/clan/${conv.clanId}`);
    else if (conv.otherUser) router.push(`/user/${conv.otherUser.id}`);
  }

  function menuActions(m: ChatItem): SheetAction[] {
    const mine = String(m.sender.id) === String(user?.id);
    if (mine && m.status === 'failed' && m.clientId) {
      return [
        { label: t('chat.retry'), onPress: () => deliver(m.clientId!, m.text) },
        { label: t('chat.discard'), destructive: true, onPress: () => setItems((cur) => dropPending(cur, m.clientId!)) },
      ];
    }
    if (mine || isLocal(m)) return [];
    return [
      { label: t('chat.openProfile'), onPress: () => router.push(`/user/${m.sender.id}`) },
      { label: t('chat.reportMessage'), destructive: true, onPress: () => router.push({ pathname: '/report', params: { targetType: 'message', targetId: String(m.id) } }) },
    ];
  }

  const header = (
    <View style={{ paddingTop: insets.top, borderBottomWidth: HAIRLINE, borderBottomColor: c.separator, backgroundColor: c.bg }}>
      <NavBar
        onBack={() => goBack('/chat')}
        backLabel={t('chat.title')}
        right={conv ? (
          <Pressable onPress={openHeader} accessibilityRole="link" accessibilityLabel={isClan ? t('chat.openClan') : t('chat.openProfile')} hitSlop={6}>
            {isClan
              ? <ClanLogo clan={{ id: conv.clanId ?? conv.id, tag: conv.title.slice(0, 2).toLocaleUpperCase(), logoUrl: conv.avatarUrl }} size={36} />
              : <Avatar uri={photoUri(conv.avatarUrl)} name={conv.title} size={36} />}
          </Pressable>
        ) : null}
        title={conv?.title}
        subtitle={isClan ? t('chat.clanChat') : undefined}
      />
    </View>
  );

  if (noAccess) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {header}
        <EmptyState icon="lock" title={t('chat.noAccess')} actionLabel={t('common.back')} onAction={() => goBack('/chat')} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {header}
      {status === 'offline' ? (
        <Txt variant="footnote" tone="label2" center style={{ paddingVertical: 4 }} accessibilityLiveRegion="polite">{t('chat.offline')}</Txt>
      ) : null}
      {!loaded && loadError ? <ErrorState message={errorMessage(loadError, t)} onRetry={load} style={{ flex: 1 }} /> : !loaded ? <LoadingState /> : (
        <FlatList
          inverted
          data={rows}
          keyExtractor={(r) => r.key}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12, width: '100%', maxWidth: 720, alignSelf: 'center' }}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={{ transform: [{ scaleY: -1 }] }}>
              <EmptyState icon="chat" title={t('chat.noMessagesYet')} />
            </View>
          }
          ListFooterComponent={
            loadingOlder ? (
              <View style={{ paddingVertical: 12 }} accessibilityLabel={t('chat.loadingOlder')}><ActivityIndicator color={c.label2} /></View>
            ) : hasMore ? (
              <Pressable onPress={loadOlder} accessibilityRole="button" style={{ minHeight: TAP, alignItems: 'center', justifyContent: 'center' }}>
                <Txt variant="footnote" tone="tint">{t('chat.loadOlder')}</Txt>
              </Pressable>
            ) : items.length ? (
              <Txt variant="footnote" tone="label2" center style={{ paddingVertical: 12 }}>{t('chat.startOfChat')}</Txt>
            ) : undefined
          }
          renderItem={({ item }) => (
            <RowView
              row={item}
              clan={isClan}
              words={words}
              hasMenu={item.kind === 'msg' && menuActions(item.msg).length > 0}
              onMenu={(m) => (menuActions(m).length ? setMenu(m) : null)}
            />
          )}
        />
      )}
      {sendError ? <Txt variant="footnote" tone="destructive" center role="alert" style={{ paddingHorizontal: 16, paddingTop: 6 }}>{sendError}</Txt> : null}
      <Composer
        value={text}
        onChange={setText}
        onSend={send}
        placeholder={isClan ? t('chat.placeholderClan') : t('chat.placeholder')}
        bottom={insets.bottom}
        disabled={!loaded}
      />
      <ActionSheet
        visible={!!menu}
        title={menu ? `${menu.sender.displayName}: ${menu.text.slice(0, 80)}` : undefined}
        actions={menu ? menuActions(menu) : []}
        onClose={() => setMenu(null)}
      />
    </KeyboardAvoidingView>
  );
}

function RowView({ row, clan, words, onMenu, hasMenu }: {
  row: ChatRow; clan: boolean; words: { today: string; yesterday: string; months: string[] }; onMenu: (m: ChatItem) => void;
  /** false for my own sent messages: no long-press menu, so no hint */
  hasMenu: boolean;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  if (row.kind === 'day') {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 10 }}>
        <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, backgroundColor: c.fill }}>
          <Txt variant="caption" tone="label2" accessibilityRole="header">{dayLabel(row.day, new Date(), words)}</Txt>
        </View>
      </View>
    );
  }
  const { msg, mine, firstOfRun, lastOfRun } = row;
  const showAvatar = clan && !mine;
  const failed = msg.status === 'failed';
  const sending = msg.status === 'sending';
  const R = 18;
  const bubbleRadius = mine
    ? { borderTopRightRadius: firstOfRun ? R : 6, borderBottomRightRadius: lastOfRun ? R : 6 }
    : { borderTopLeftRadius: firstOfRun ? R : 6, borderBottomLeftRadius: lastOfRun ? R : 6 };
  const time = formatTime(msg.createdAt);
  const a11y = [mine ? t('chat.you') : msg.sender.displayName, msg.text, time, sending ? t('chat.sending') : failed ? t('chat.failed') : null]
    .filter(Boolean).join(', ');
  return (
    <View style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8, marginTop: firstOfRun ? 8 : 2 }}>
      {showAvatar ? (
        lastOfRun ? (
          <Pressable onPress={() => router.push(`/user/${msg.sender.id}`)} accessibilityRole="link" accessibilityLabel={msg.sender.displayName}>
            <Avatar uri={photoUri(msg.sender.avatarUrl)} name={msg.sender.displayName} size={30} />
          </Pressable>
        ) : <View style={{ width: 30 }} />
      ) : null}
      <View style={{ maxWidth: '78%', alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }}>
        {showAvatar && firstOfRun ? (
          <Txt variant="caption" tone="label2" style={{ paddingHorizontal: 12 }} numberOfLines={1}>{msg.sender.displayName}</Txt>
        ) : null}
        <Pressable
          onLongPress={hasMenu ? () => { tapFeedback(); onMenu(msg); } : undefined}
          onPress={failed ? () => onMenu(msg) : undefined}
          delayLongPress={350}
          accessibilityRole={failed ? 'button' : undefined}
          accessibilityLabel={a11y}
          accessibilityHint={hasMenu ? t('chat.messageActions') : undefined}
          accessibilityActions={hasMenu ? [{ name: 'longpress', label: t('chat.messageActions') }] : undefined}
          onAccessibilityAction={hasMenu ? () => onMenu(msg) : undefined}
          style={({ pressed }) => [
            {
              paddingHorizontal: 12, paddingVertical: 8, borderRadius: R,
              backgroundColor: mine ? c.tint : c.card,
              opacity: sending ? 0.7 : 1,
            },
            bubbleRadius,
            failed && { borderWidth: 1, borderColor: c.destructive },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Txt color={mine ? c.onTint : c.label} selectable style={typeScale.body}>{msg.text}</Txt>
          <Txt variant="caption" color={mine ? c.onTint : c.label2} style={{ alignSelf: 'flex-end', opacity: 0.75, marginTop: 2, fontWeight: '400' }}>
            {sending ? t('chat.sending') : time}
          </Txt>
        </Pressable>
        {failed ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 }}>
            <Icon name="info" size={14} color={c.destructive} />
            <Txt variant="caption" tone="destructive">{t('chat.failed')}</Txt>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Composer({ value, onChange, onSend, placeholder, bottom, disabled }: {
  value: string; onChange: (s: string) => void; onSend: () => void; placeholder: string; bottom: number; disabled?: boolean;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const can = !disabled && value.trim().length > 0;
  return (
    <View style={{ borderTopWidth: HAIRLINE, borderTopColor: c.separator, backgroundColor: c.bg, paddingTop: 8, paddingBottom: 8 + bottom, paddingHorizontal: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
        <View style={{ flex: 1, minHeight: TAP, borderRadius: TAP / 2, backgroundColor: c.card, borderWidth: HAIRLINE, borderColor: c.separator, paddingHorizontal: 16, justifyContent: 'center' }}>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={c.label2}
            accessibilityLabel={placeholder}
            multiline
            maxLength={MAX_MESSAGE + 100}
            onKeyPress={(e) => {
              // web: Enter sends, Shift+Enter makes a new line
              const ne = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
              if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
                (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                onSend();
              }
            }}
            numberOfLines={1}
            style={[typeScale.body, { color: c.label, paddingVertical: 10, maxHeight: 120, outlineWidth: 0, outlineStyle: 'none' } as object]}
          />
        </View>
        <Pressable
          onPress={onSend}
          disabled={!can}
          accessibilityRole="button"
          accessibilityLabel={t('chat.send')}
          accessibilityState={{ disabled: !can }}
          style={({ pressed }) => [
            { width: TAP, height: TAP, borderRadius: TAP / 2, backgroundColor: can ? c.tint : c.fill, alignItems: 'center', justifyContent: 'center' },
            pressed && { opacity: 0.75 },
          ]}
        >
          <Icon name="message" size={20} color={can ? c.onTint : c.label3} strokeWidth={2.4} />
        </Pressable>
      </View>
    </View>
  );
}
