import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { Txt } from './ui/Text';
import { useTheme } from '../lib/themeContext';
import { useI18n } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { ApiError } from '../lib/apiClient';
import { followButtonState, followErrorKey } from '../lib/postsLogic';
import { selectionFeedback } from '../lib/haptics';
import { TAP } from '../lib/theme';
import type { FollowState, Id } from '../lib/types';

export interface FollowTarget {
  id: Id;
  displayName: string;
  isFollowing?: boolean;
  followsMe?: boolean;
  isBlocked?: boolean;
  isMe?: boolean;
}

/**
 * "İzlə" (orange) / "Geri izlə" (orange) / "İzləyirsən" (grey, tap = unfollow). Optimistic: flips at once,
 * goes back and shows the error if the server says no. `size="large"` = profile header (flex, 44 tall),
 * `small` = list rows (min 96 wide, 44 tall).
 */
export function FollowButton({ user, onChange, onError, size = 'small', style }: {
  user: FollowTarget;
  onChange?: (s: Partial<FollowState> & { isFollowing: boolean }) => void;
  onError?: (message: string) => void;
  size?: 'small' | 'large';
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const { user: me } = useAuth();
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<boolean | null>(null);
  // the parent got a newer answer (or another person): show that
  useEffect(() => { setLocal(null); }, [user.id, user.isFollowing]);
  const following = local ?? !!user.isFollowing;
  const state = followButtonState({ ...user, isFollowing: following }, me?.id);
  if (state.kind === 'hidden' || state.kind === 'blocked') return null;

  async function press() {
    if (!me) return router.push('/login');
    if (busy) return;
    const next = !following;
    selectionFeedback();
    setBusy(true);
    setLocal(next);
    onChange?.({ isFollowing: next });
    try {
      const s = next ? await api.follow(user.id) : await api.unfollow(user.id);
      setLocal(s.isFollowing);
      onChange?.(s);
    } catch (e) {
      setLocal(!next);
      onChange?.({ isFollowing: !next });
      onError?.(t(followErrorKey(e instanceof ApiError ? e.status : undefined)));
    } finally {
      setBusy(false);
    }
  }

  const grey = state.kind === 'following';
  const label = state.kind === 'following' ? t('follow.following') : state.kind === 'followBack' ? t('follow.followBack') : t('follow.follow');
  const fg = grey ? c.label : c.onTint;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: grey, busy }}
      accessibilityLabel={grey ? t('follow.followingA11y', { name: user.displayName }) : `${label}: ${user.displayName}`}
      onPress={press}
      hitSlop={size === 'small' ? 4 : 0}
      style={({ pressed }) => [
        { height: TAP, borderRadius: TAP / 2, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: grey ? c.fill : c.tint },
        size === 'small' ? { minWidth: 96 } : { flex: 1 },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {busy && size === 'large' ? <ActivityIndicator color={fg} /> : <Txt variant="subhead" color={fg} style={{ fontWeight: '600' }} numberOfLines={1}>{label}</Txt>}
    </Pressable>
  );
}
