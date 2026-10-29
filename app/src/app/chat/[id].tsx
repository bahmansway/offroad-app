import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, EmptyState, ErrorState, Icon, IconButton, LoadingState, NavBar, Thumb, Txt, goBack, useTheme } from '../../components/ui';
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
import { confirmAsync } from '../../lib/dialogs';
import { formatDate, sameId } from '../../lib/format';
import { canDeleteMessage, canPinMessage } from '../../lib/permissions';
import { isSystem, messageText, systemText } from '../../lib/systemMessages';
import { HAIRLINE, TAP, type as typeScale } from '../../lib/theme';
import { tapFeedback } from '../../lib/haptics';
import {
  applyDeleted, buildRows, dayLabel, dropPending, formatTime, isLocal, MAX_MESSAGE, mergeLatestPage, mergeMessages, newClientId,
  oldestId, pendingMessage, pinnedAfterDelete, setStatus, type ChatItem, type ChatRow,
} from '../../lib/chatLogic';
import type { Conversation, Pinned } from '../../lib/types';

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
  const [pinned, setPinned] = useState<Pinned | null>(conv?.pinned ?? null);
  const [muteBusy, setMuteBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
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
      setPinned(cv.pinned ?? null);
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
    if (focused.current && !sameId(m.sender?.id, user?.id)) markRead(id);
  }), [id, subscribe, markRead, user?.id]);

  // live delete / pin / event changes (read-only after cancel, removed from the event)
  const reloadConv = useCallback(async () => {
    try {
      const cv = await api.conversation(id);
      setConv(cv);
      setPinned(cv.pinned ?? null);
    } catch (e) {
      if (isGone(e)) setNoAccess(true);
    }
  }, [id]);
  useEffect(() => {
    const offs = [
      chat.on('deleted', (dl) => {
        if (!sameId(dl.conversationId, id)) return;
        setItems((cur) => applyDeleted(cur, dl));
        setPinned((p) => pinnedAfterDelete(p, dl.id));
      }),
      chat.on('pinned', (p) => { if (sameId(p.conversationId, id)) setPinned(p.pinned); }),
      chat.on('eventUpdated', (u) => { if (conv?.eventId && sameId(u.eventId, conv.eventId)) reloadConv(); }),
    ];
    return () => offs.forEach((off) => off());
  }, [chat, id, conv?.eventId, reloadConv]);

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
      // event chat: 403 = became read-only (cancelled/finished) or I was removed → ask again
      if (e instanceof ApiError && e.status === 403 && kind === 'event') reloadConv();
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
  const isEvent = conv?.type === 'event';
  const group = isClan || isEvent;
  const readOnly = !!conv?.readOnly;
  const muted = !!conv?.muted;

  async function toggleMute() {
    if (!conv) return;
    setMuteBusy(true);
    setNote(null);
    try {
      await chat.setMuted(id, !muted);
      setConv({ ...conv, muted: !muted });
      setNote(!muted ? t('chat.mutedOn') : t('chat.mutedOff'));
    } catch (e) {
      setNote(errorMessage(e, t));
    } finally {
      setMuteBusy(false);
    }
  }

  async function del(m: ChatItem) {
    if (!(await confirmAsync(t('chat.deleteConfirm'), t('common.delete'), t('common.cancel')))) return;
    try {
      await api.deleteMessage(id, m.id);
      setItems((cur) => applyDeleted(cur, { id: m.id, deletedAt: new Date().toISOString() }));
      setPinned((p) => pinnedAfterDelete(p, m.id));
    } catch (e) {
      setSendError(e instanceof ApiError && e.status === 403 ? t('chat.deleteFailed') : errorMessage(e, t));
    }
  }

  async function pin(m: ChatItem) {
    try {
      const r = await api.pin(id, m.id);
      setPinned(r.pinned);
      chat.patch(id, { pinned: r.pinned });
    } catch (e) {
      setSendError(e instanceof ApiError && (e.status === 400 || e.status === 403) ? t('chat.pinFailed') : errorMessage(e, t));
    }
  }

  async function unpin() {
    try {
      await api.unpin(id);
      setPinned(null);
      chat.patch(id, { pinned: null });
    } catch (e) {
      setSendError(errorMessage(e, t));
    }
  }
  const words = useMemo(() => ({ today: t('chat.today'), yesterday: t('chat.yesterday'), months: d.chat.months }), [t, d]);

  function openHeader() {
    if (!conv) return;
    if (conv.type === 'clan' && conv.clanId) router.push(`/clan/${conv.clanId}`);
    else if (conv.type === 'event' && conv.eventId) router.push(`/event/${conv.eventId}`);
    else if (conv.otherUser) router.push(`/user/${conv.otherUser.id}`);
  }

  function menuActions(m: ChatItem): SheetAction[] {
    if (isSystem(m) || !m.sender) return [];
    const sender = m.sender;
    const mine = sameId(sender.id, user?.id);
    if (mine && m.status === 'failed' && m.clientId) {
      return [
        { label: t('chat.retry'), onPress: () => deliver(m.clientId!, m.text) },
        { label: t('chat.discard'), destructive: true, onPress: () => setItems((cur) => dropPending(cur, m.clientId!)) },
      ];
    }
    if (isLocal(m)) return [];
    const out: SheetAction[] = [];
    if (canPinMessage(conv, m)) {
      out.push(pinned && sameId(pinned.message.id, m.id)
        ? { label: t('chat.unpin'), onPress: unpin }
        : { label: t('chat.pin'), onPress: () => pin(m) });
    }
    if (mine) {
      if (canDeleteMessage(m, user?.id, { readOnly })) out.push({ label: t('chat.deleteMessage'), destructive: true, onPress: () => del(m) });
      return out;
    }
    if (m.deletedAt) return out;
    out.push({ label: t('chat.openProfile'), onPress: () => router.push(`/user/${sender.id}`) });
    out.push({ label: t('chat.reportMessage'), destructive: true, onPress: () => router.push({ pathname: '/report', params: { targetType: 'message', targetId: String(m.id) } }) });
    return out;
  }

  const header = (
    <View style={{ paddingTop: insets.top, borderBottomWidth: HAIRLINE, borderBottomColor: c.separator, backgroundColor: c.bg }}>
      <NavBar
        onBack={() => goBack('/chat')}
        backLabel={t('chat.title')}
        right={conv ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <IconButton
              icon={muted ? 'bellOff' : 'bell'}
              label={muted ? t('chat.unmute') : t('chat.mute')}
              onPress={toggleMute}
              disabled={muteBusy}
              color={muted ? c.label2 : c.tint}
            />
            <Pressable
              onPress={openHeader}
              accessibilityRole="link"
              accessibilityLabel={isClan ? t('chat.openClan') : isEvent ? t('chat.openEvent') : t('chat.openProfile')}
              hitSlop={6}
              style={{ minWidth: TAP, minHeight: TAP, alignItems: 'center', justifyContent: 'center' }}
            >
              {isClan
                ? <ClanLogo clan={{ id: conv.clanId ?? conv.id, tag: conv.title.slice(0, 2).toLocaleUpperCase(), logoUrl: conv.avatarUrl }} size={36} />
                : isEvent
                  ? <Thumb seed={conv.eventId ?? conv.id} uri={photoUri(conv.avatarUrl)} icon="events" size={36} rounded={10} />
                  : <Avatar uri={photoUri(conv.avatarUrl)} name={conv.title} size={36} />}
            </Pressable>
          </View>
        ) : null}
        title={conv?.title}
        subtitle={isClan ? t('chat.clanChat') : isEvent ? t('chat.eventChat') : muted ? t('chat.muted') : undefined}
      />
      {pinned ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 6, minHeight: 52, borderTopWidth: HAIRLINE, borderTopColor: c.separator }}>
          <Icon name="pinMsg" size={18} color={c.tint} />
          <View style={{ flex: 1, minWidth: 0 }} accessible accessibilityLabel={`${t('chat.pinned')}: ${pinned.message.sender ? `${pinned.message.sender.displayName}: ` : ''}${messageText(pinned.message, t)}`}>
            <Txt variant="caption" tone="tint">{t('chat.pinned')}</Txt>
            <Txt variant="subhead" numberOfLines={1}>
              {pinned.message.sender ? `${pinned.message.sender.displayName}: ` : ''}{messageText(pinned.message, t)}
            </Txt>
          </View>
          {conv?.canPin && !readOnly ? <IconButton icon="close" label={t('chat.unpin')} onPress={unpin} color={c.label2} /> : null}
        </View>
      ) : null}
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
              clan={group}
              words={words}
              hasMenu={item.kind === 'msg' && menuActions(item.msg).length > 0}
              onMenu={(m) => (menuActions(m).length ? setMenu(m) : null)}
            />
          )}
        />
      )}
      {sendError ? <Txt variant="footnote" tone="destructive" center role="alert" style={{ paddingHorizontal: 16, paddingTop: 6 }}>{sendError}</Txt> : null}
      {note ? <Txt variant="footnote" tone="label2" center accessibilityLiveRegion="polite" style={{ paddingHorizontal: 16, paddingTop: 6 }}>{note}</Txt> : null}
      {readOnly ? (
        <View style={{ borderTopWidth: HAIRLINE, borderTopColor: c.separator, backgroundColor: c.bg, paddingTop: 12, paddingBottom: 12 + insets.bottom, paddingHorizontal: 16, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
          <Icon name="lock" size={16} color={c.label2} />
          <Txt variant="footnote" tone="label2" accessibilityLiveRegion="polite" style={{ flexShrink: 1 }}>
            {conv?.readOnlyUntil ? t('chat.readOnlyUntil', { date: formatDate(conv.readOnlyUntil) }) : t('chat.readOnly')}
          </Txt>
        </View>
      ) : (
        <Composer
          value={text}
          onChange={setText}
          onSend={send}
          placeholder={isClan ? t('chat.placeholderClan') : isEvent ? t('chat.placeholderEvent') : t('chat.placeholder')}
          bottom={insets.bottom}
          disabled={!loaded}
        />
      )}
      <ActionSheet
        visible={!!menu}
        title={menu ? `${menu.sender?.displayName ?? ''}: ${messageText(menu, t).slice(0, 80)}` : undefined}
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
  if (row.kind === 'system') {
    const text = systemText(row.msg, t);
    return (
      <View style={{ alignItems: 'center', paddingVertical: 6, paddingHorizontal: 24 }}>
        <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: c.fill, maxWidth: 520 }}
          accessible accessibilityLabel={`${t('chat.systemMessage')}: ${text}, ${formatTime(row.msg.createdAt)}`}>
          <Txt variant="footnote" tone="label2" center>{text}</Txt>
        </View>
      </View>
    );
  }
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
  const sender = msg.sender!;
  const deleted = !!msg.deletedAt;
  const showAvatar = clan && !mine;
  const failed = msg.status === 'failed';
  const sending = msg.status === 'sending';
  const R = 18;
  const bubbleRadius = mine
    ? { borderTopRightRadius: firstOfRun ? R : 6, borderBottomRightRadius: lastOfRun ? R : 6 }
    : { borderTopLeftRadius: firstOfRun ? R : 6, borderBottomLeftRadius: lastOfRun ? R : 6 };
  const time = formatTime(msg.createdAt);
  const a11y = [mine ? t('chat.you') : sender.displayName, deleted ? t('chat.deleted') : msg.text, time, sending ? t('chat.sending') : failed ? t('chat.failed') : null]
    .filter(Boolean).join(', ');
  return (
    <View style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8, marginTop: firstOfRun ? 8 : 2 }}>
      {showAvatar ? (
        lastOfRun ? (
          <Pressable onPress={() => router.push(`/user/${sender.id}`)} accessibilityRole="link" accessibilityLabel={sender.displayName}>
            <Avatar uri={photoUri(sender.avatarUrl)} name={sender.displayName} size={30} />
          </Pressable>
        ) : <View style={{ width: 30 }} />
      ) : null}
      <View style={{ maxWidth: '78%', alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }}>
        {showAvatar && firstOfRun ? (
          <Txt variant="caption" tone="label2" style={{ paddingHorizontal: 12 }} numberOfLines={1}>{sender.displayName}</Txt>
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
              backgroundColor: deleted ? 'transparent' : mine ? c.tint : c.card,
              borderWidth: deleted ? 1 : 0,
              borderColor: c.separator,
              opacity: sending ? 0.7 : 1,
            },
            bubbleRadius,
            failed && { borderWidth: 1, borderColor: c.destructive },
            pressed && { opacity: 0.8 },
          ]}
        >
          {deleted ? (
            <Txt tone="label2" style={[typeScale.body, { fontStyle: 'italic' }]}>{t('chat.deleted')}</Txt>
          ) : (
            <Txt color={mine ? c.onTint : c.label} selectable style={typeScale.body}>{msg.text}</Txt>
          )}
          <Txt variant="caption" color={deleted ? c.label2 : mine ? c.onTint : c.label2} style={{ alignSelf: 'flex-end', opacity: 0.75, marginTop: 2, fontWeight: '400' }}>
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
