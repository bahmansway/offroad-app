import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { confirmAsync } from '../../lib/dialogs';
import { errorMessage } from '../../lib/errors';
import { applyLike } from '../../lib/postsLogic';
import { selectionFeedback, successFeedback, tapFeedback } from '../../lib/haptics';
import { shareLink } from '../../lib/share';
import { sameId } from '../../lib/format';
import type { Post } from '../../lib/types';
import type { SheetAction } from '../ActionSheet';

/**
 * Like / save / share / edit / delete / report / block for one post. Like and save are optimistic:
 * the screen changes at once and goes back if the server says no. `onPatch` gets the changed fields,
 * `onRemoved` is called after delete. After blocking the author `onBlocked(authorId)` runs (every post of theirs
 * must go from the list); without it `onRemoved` is used.
 */
export function usePostActions(post: Post, onPatch: (p: Partial<Post>) => void, onRemoved?: () => void, onBlocked?: (authorId: Post['author']['id']) => void) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const mine = sameId(user?.id, post.author.id);

  const setLike = useCallback(async (liked: boolean) => {
    if (!user) return router.push('/login');
    const before = { likeCount: post.likeCount, likedByMe: post.likedByMe };
    onPatch(applyLike(post, liked));
    try {
      const r = liked ? await api.likePost(post.id) : await api.unlikePost(post.id);
      onPatch({ likeCount: r.likeCount, likedByMe: r.likedByMe });
    } catch (e) {
      onPatch(before);
      setNote({ text: errorMessage(e, t), error: true });
    }
  }, [user, post, onPatch, t]);

  const toggleLike = useCallback(() => { selectionFeedback(); return setLike(!post.likedByMe); }, [setLike, post.likedByMe]);
  /** double tap only ever likes (never unlikes), with a light haptic */
  const doubleTapLike = useCallback(() => { tapFeedback(); if (!post.likedByMe) setLike(true); }, [setLike, post.likedByMe]);

  const toggleSave = useCallback(async () => {
    if (!user) return router.push('/login');
    const next = !post.savedByMe;
    selectionFeedback();
    onPatch({ savedByMe: next });
    try {
      const r = next ? await api.savePost(post.id) : await api.unsavePost(post.id);
      onPatch({ savedByMe: r.savedByMe });
    } catch (e) {
      onPatch({ savedByMe: !next });
      setNote({ text: errorMessage(e, t), error: true });
    }
  }, [user, post.savedByMe, post.id, onPatch, t]);

  const share = useCallback(async () => {
    const r = await shareLink('post', post.id, t('post.shareMessage'));
    if (r === 'copied') setNote({ text: t('post.linkCopied'), error: false });
    else if (r === 'failed') setNote({ text: t('post.shareFailed'), error: true });
  }, [post.id, t]);

  async function remove() {
    if (!(await confirmAsync(t('post.deleteConfirm'), t('common.delete'), t('common.cancel'), { destructive: true }))) return;
    try {
      await api.deletePost(post.id);
      successFeedback();
      onRemoved?.();
    } catch (e) {
      setNote({ text: errorMessage(e, t), error: true });
    }
  }

  async function blockAuthor() {
    if (!user) return router.push('/login');
    if (!(await confirmAsync(t('profile.blockConfirm', { name: post.author.displayName }), t('profile.block'), t('common.cancel'), { destructive: true }))) return;
    try {
      await api.block(post.author.id);
      if (onBlocked) onBlocked(post.author.id); else onRemoved?.();
    } catch (e) {
      setNote({ text: errorMessage(e, t), error: true });
    }
  }

  const menu: SheetAction[] = mine
    ? [
        { label: t('post.edit'), onPress: () => router.push(`/post/edit/${post.id}`) },
        { label: t('post.delete'), destructive: true, onPress: remove },
      ]
    : [
        { label: t('post.report'), destructive: true, onPress: () => router.push(user ? { pathname: '/report', params: { targetType: 'post', targetId: String(post.id) } } : '/login') },
        { label: t('profile.block'), destructive: true, onPress: blockAuthor },
      ];

  return { toggleLike, doubleTapLike, toggleSave, share, menu, mine, note, setNote };
}
