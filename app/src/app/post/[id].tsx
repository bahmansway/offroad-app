import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, EmptyState, ErrorState, Icon, LoadingState, NavBar, PillButton, Txt, goBack, useTheme } from '../../components/ui';
import { ActionSheet, MoreMenu, type SheetAction } from '../../components/ActionSheet';
import { PostCard } from '../../components/posts/PostCard';
import { usePostActions } from '../../components/posts/usePostActions';
import { photoUri } from '../../components/Rows';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/apiClient';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import { confirmAsync } from '../../lib/dialogs';
import { appendPage, MAX_COMMENT, timeAgo } from '../../lib/postsLogic';
import { sameId } from '../../lib/format';
import { type as typeScale, TAP } from '../../lib/theme';
import type { Comment, Post } from '../../lib/types';

/** One post (also the target of share links /p/:id) with its comments, oldest first. */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { c } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<Comment | null>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);

  /** only the newest load may fill the page (coming back from edit, account switch, quick refocus) */
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const my = ++loadSeq.current;
    setError(null);
    try {
      const [p, cm] = await Promise.all([api.post(id), api.comments(id)]);
      if (my !== loadSeq.current) return;
      setPost(p);
      setComments(cm.items);
      setCursor(cm.nextCursor);
    } catch (e) {
      if (my === loadSeq.current) setError(e);
    }
  }, [id]);
  // every time the page shows again (e.g. after "Redaktə et"), and for another account
  useFocusEffect(useCallback(() => { load(); }, [load, user?.id]));  // eslint-disable-line react-hooks/exhaustive-deps

  const patch = useCallback((p: Partial<Post>) => setPost((cur) => (cur ? { ...cur, ...p } : cur)), []);
  const removed = useCallback(() => goBack('/'), []);

  if (error) {
    const gone = error instanceof ApiError && error.status === 404;
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <NavBar title={t('post.title')} onBack={() => goBack('/')} />
        {gone ? <EmptyState icon="photo" title={t('post.gone')} actionLabel={t('tabs.home')} onAction={() => router.replace('/')} />
          : <ErrorState message={errorMessage(error, t)} onRetry={load} />}
      </View>
    );
  }
  if (!post) return <LoadingState />;

  async function loadMore() {
    if (!cursor || moreBusy) return;
    setMoreBusy(true);
    try {
      const r = await api.comments(id, cursor);
      setComments((cur) => appendPage(cur ?? [], r.items));
      setCursor(r.nextCursor);
    } catch (e) {
      setNote(errorMessage(e, t));
    } finally {
      setMoreBusy(false);
    }
  }

  async function send() {
    if (!user) return router.push('/login');
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setNote(null);
    try {
      const cm = await api.addComment(id, body);
      setText('');
      // the new comment is the newest: show it at the end (only once every older page is on screen)
      setComments((cur) => (cursor ? cur : appendPage(cur ?? [], [cm])));
      patch({ commentCount: post!.commentCount + 1 });
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      setNote(e instanceof ApiError && e.code === 'RATE_LIMITED' ? t('post.commentRate') : e instanceof ApiError && e.status === 404 ? t('post.gone') : t('post.commentFailed'));
    } finally {
      setSending(false);
    }
  }

  async function deleteComment(cm: Comment) {
    if (!(await confirmAsync(t('post.deleteCommentConfirm'), t('common.delete'), t('common.cancel'), { destructive: true }))) return;
    try {
      await api.deleteComment(cm.id);
      setComments((cur) => cur?.filter((x) => !sameId(x.id, cm.id)) ?? cur);
      patch({ commentCount: Math.max(0, post!.commentCount - 1) });
    } catch (e) {
      setNote(errorMessage(e, t));
    }
  }

  const commentActions = (cm: Comment): SheetAction[] => [
    ...(cm.canDelete ? [{ label: t('post.deleteComment'), destructive: true, onPress: () => deleteComment(cm) }] : []),
    ...(!sameId(cm.author.id, user?.id) ? [{ label: t('post.reportComment'), destructive: true, onPress: () => router.push(user ? { pathname: '/report', params: { targetType: 'comment', targetId: String(cm.id) } } : '/login') }] : []),
  ];
  const canSend = !!text.trim() && !sending;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.card }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top, backgroundColor: c.card, borderBottomWidth: 0.5, borderBottomColor: c.separator }}>
        <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <NavBar title={t('post.title')} onBack={() => goBack('/')} right={<NavMenu post={post} onPatch={patch} onRemoved={removed} />} />
        </View>
      </View>
      <ScrollView ref={scroller} contentContainerStyle={{ width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        <PostCard post={post} variant="detail" hideMenu onPatch={patch} onRemoved={removed} onComment={() => input.current?.focus()} />
        <View style={{ borderTopWidth: 0.5, borderTopColor: c.separator }} accessibilityLabel={t('post.comments', { count: post.commentCount })}>
          <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: '600' }} accessibilityRole="header">
            {t('post.comments', { count: post.commentCount })}
          </Txt>
          {comments === null ? <LoadingState inline /> : comments.length === 0 ? (
            <Txt variant="subhead" tone="label2" style={{ paddingHorizontal: 16, paddingVertical: 12 }}>{t('post.noComments')}</Txt>
          ) : comments.map((cm) => {
            const isAuthor = sameId(cm.author.id, post.author.id);
            const acts = commentActions(cm);
            const time = timeAgo(cm.createdAt, t);
            return (
              <View key={cm.id} style={{ flexDirection: 'row', gap: 10, paddingLeft: 16, paddingRight: 4, paddingVertical: 8 }}>
                <Pressable accessibilityRole="link" accessibilityLabel={cm.author.displayName} onPress={() => router.push(`/user/${cm.author.id}`)}>
                  <Avatar uri={photoUri(cm.author.avatarUrl)} name={cm.author.displayName} size={32} />
                </Pressable>
                <View style={{ flex: 1, minWidth: 0 }} accessible accessibilityLabel={[cm.author.displayName, isAuthor ? t('post.author') : null, time, cm.text].filter(Boolean).join(', ')}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Txt variant="subhead" style={{ fontWeight: '600' }}>{cm.author.displayName}</Txt>
                    {isAuthor ? (
                      <View style={{ height: 18, paddingHorizontal: 6, borderRadius: 9, backgroundColor: c.fill, justifyContent: 'center' }}>
                        <Txt style={{ fontSize: 11, lineHeight: 14, fontWeight: '600' }} tone="label2">{t('post.author')}</Txt>
                      </View>
                    ) : null}
                    <Txt variant="footnote" tone="label2">{time}</Txt>
                  </View>
                  <Txt variant="subhead" style={{ marginTop: 2 }}>{cm.text}</Txt>
                </View>
                {acts.length ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('post.commentMenu', { name: cm.author.displayName })}
                    onPress={() => setMenuFor(cm)}
                    style={({ pressed }) => [{ width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}
                  >
                    <Icon name="more" size={18} color={c.label2} />
                  </Pressable>
                ) : <View style={{ width: TAP }} />}
              </View>
            );
          })}
          {cursor ? <PillButton title={t('post.moreComments')} variant="plain" size="small" onPress={loadMore} loading={moreBusy} /> : null}
        </View>
      </ScrollView>

      {note ? <Txt variant="footnote" tone="destructive" role="alert" center style={{ paddingHorizontal: 16, paddingVertical: 4 }}>{note}</Txt> : null}
      {/* composer */}
      <View style={{ borderTopWidth: 0.5, borderTopColor: c.separator, backgroundColor: c.card, paddingTop: 8, paddingBottom: 8 + insets.bottom, paddingLeft: 16, paddingRight: 12 }}>
        <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {user ? <Avatar uri={photoUri(user.avatarUrl)} name={user.displayName} size={32} /> : null}
          <TextInput
            ref={input}
            value={text}
            onChangeText={(s) => setText(s.slice(0, MAX_COMMENT))}
            placeholder={t('post.writeComment')}
            placeholderTextColor={c.label2}
            accessibilityLabel={t('post.writeComment')}
            maxLength={MAX_COMMENT}
            multiline
            onFocus={() => { if (!user) router.push('/login'); }}
            style={[typeScale.body, { flex: 1, minWidth: 0, minHeight: TAP, maxHeight: 120, borderRadius: 22, backgroundColor: c.fill, color: c.label, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, outlineWidth: 0 } as object]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('post.send')}
            accessibilityState={{ disabled: !canSend, busy: sending }}
            disabled={!canSend}
            onPress={send}
            style={{ width: TAP, height: TAP, borderRadius: 22, backgroundColor: canSend ? c.tint : c.fill, alignItems: 'center', justifyContent: 'center' }}
          >
            {sending ? <ActivityIndicator color={c.onTint} /> : <Icon name="arrowUp" size={22} color={canSend ? c.onTint : c.label3} strokeWidth={2.4} />}
          </Pressable>
        </View>
      </View>
      <ActionSheet visible={!!menuFor} title={menuFor ? t('post.commentMenu', { name: menuFor.author.displayName }) : undefined} actions={menuFor ? commentActions(menuFor) : []} onClose={() => setMenuFor(null)} />
    </KeyboardAvoidingView>
  );
}

function NavMenu({ post, onPatch, onRemoved }: { post: Post; onPatch: (p: Partial<Post>) => void; onRemoved: () => void }) {
  const { t } = useI18n();
  const a = usePostActions(post, onPatch, onRemoved);
  return <MoreMenu actions={a.menu} glass={false} title={post.author.displayName} label={a.mine ? t('post.menu') : t('post.menuOther')} />;
}
