import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Avatar } from '../ui/Avatar';
import { Icon, type IconName } from '../ui/Icon';
import { Txt } from '../ui/Text';
import { ActionSheet } from '../ActionSheet';
import { photoUri } from '../Rows';
import { PhotoCarousel, PhotoDots } from './PhotoCarousel';
import { usePostActions } from './usePostActions';
import { useTheme } from '../../lib/themeContext';
import { useI18n } from '../../lib/i18n';
import { captionIsLong, timeAgo } from '../../lib/postsLogic';
import { radius, TAP } from '../../lib/theme';
import type { Post } from '../../lib/types';

/**
 * One photo post. `variant="card"` = Home feed card (radius 26, 16 px margins, tap photo → post page);
 * `variant="detail"` = full-width top of the post page (whole caption, time row, no "all comments" link).
 */
export function PostCard({ post, onPatch, onRemoved, variant = 'card', onComment, hideMenu }: {
  post: Post;
  /** detail page: the ··· lives in the nav bar instead */
  hideMenu?: boolean;
  onPatch: (p: Partial<Post>) => void;
  onRemoved?: () => void;
  variant?: 'card' | 'detail';
  /** detail page: focus the comment field */
  onComment?: () => void;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(variant === 'detail');
  const [menuOpen, setMenuOpen] = useState(false);
  const a = usePostActions(post, onPatch, onRemoved);
  const card = variant === 'card';
  const time = timeAgo(post.createdAt, t);
  const open = () => router.push(`/post/${post.id}`);
  const author = post.author;
  const long = captionIsLong(post.caption);

  return (
    <View
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={card ? { backgroundColor: c.card, borderRadius: radius.card, overflow: 'hidden' } : { backgroundColor: c.card }}
      accessibilityLabel={t('post.a11y', { name: author.displayName, time })}
      {...({ role: 'article' } as object)}
    >
      {/* author row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, paddingRight: 4, paddingVertical: 8 }}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={[author.displayName, author.clan?.tag, time].filter(Boolean).join(', ')}
          onPress={() => router.push(`/user/${author.id}`)}
          style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: 10 }, pressed && { opacity: 0.6 }]}
        >
          <Avatar uri={photoUri(author.avatarUrl)} name={author.displayName} size={36} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Txt variant="subhead" style={{ fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{author.displayName}</Txt>
              {author.clan ? (
                <View style={{ height: 20, paddingHorizontal: 7, borderRadius: 10, backgroundColor: c.stoneSoft, justifyContent: 'center' }}>
                  <Txt variant="caption" color={c.stoneText} style={{ fontSize: 11, lineHeight: 14, fontWeight: '600' }} numberOfLines={1}>{author.clan.tag}</Txt>
                </View>
              ) : null}
            </View>
            <Txt variant="footnote" tone="label2" numberOfLines={1}>
              {post.suggested ? `${t('post.suggested')} · ${time}` : time}{post.editedAt ? ` · ${t('post.edited')}` : ''}
            </Txt>
          </View>
        </Pressable>
        {hideMenu ? null : <Pressable
          accessibilityRole="button"
          accessibilityLabel={a.mine ? t('post.menu') : t('post.menuOther')}
          onPress={() => setMenuOpen(true)}
          style={({ pressed }) => [{ width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}
        >
          <Icon name="more" size={22} color={c.label2} />
        </Pressable>}
      </View>

      {/* photos */}
      <PhotoCarousel
        photos={post.photos}
        size={width}
        label={t('post.a11y', { name: author.displayName, time })}
        onDoubleTap={a.doubleTapLike}
        onTap={card ? open : undefined}
        onIndexChange={setIndex}
      />

      {/* actions */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 2 }}>
        <ActionIcon
          icon={post.likedByMe ? 'heartFill' : 'heart'}
          color={post.likedByMe ? c.tint : c.label}
          label={t('post.like')}
          selected={post.likedByMe}
          onPress={a.toggleLike}
          size={26}
        />
        <ActionIcon icon="comment" color={c.label} label={t('post.comment')} onPress={card ? open : onComment ?? open} size={25} />
        <ActionIcon icon="upload" color={c.label} label={t('post.share')} onPress={a.share} size={24} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }}>
          <PhotoDots index={index} count={post.photos.length} />
        </View>
        <View style={{ flex: 1 }} />
        <ActionIcon icon={post.savedByMe ? 'bookmarkFill' : 'bookmark'} color={c.label} label={t('post.save')} selected={post.savedByMe} onPress={a.toggleSave} size={24} />
      </View>

      {a.note ? (
        <Txt variant="footnote" tone={a.note.error ? 'destructive' : 'label2'} role={a.note.error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={{ paddingHorizontal: 16, paddingBottom: 4 }}>{a.note.text}</Txt>
      ) : null}

      {post.likeCount > 0 ? (
        <Txt variant="subhead" style={{ paddingHorizontal: 16, fontWeight: '600' }}>{t('post.likes', { count: post.likeCount })}</Txt>
      ) : null}

      {post.caption ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
          <Txt variant="subhead" numberOfLines={expanded ? undefined : 2}>
            <Txt variant="subhead" style={{ fontWeight: '600' }}>{author.displayName}</Txt>{` ${post.caption}`}
          </Txt>
          {!expanded && long ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('post.more')} onPress={() => setExpanded(true)} hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center' }}>
              <Txt variant="subhead" tone="label2">{t('post.more')}</Txt>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <PostChips post={post} />

      {card ? (
        post.commentCount > 0 ? (
          <Pressable accessibilityRole="link" onPress={open} style={({ pressed }) => [{ minHeight: TAP, justifyContent: 'center', paddingHorizontal: 16, paddingBottom: 4 }, pressed && { opacity: 0.6 }]}>
            <Txt variant="subhead" tone="label2">{t('post.allComments', { count: post.commentCount })}</Txt>
          </Pressable>
        ) : <View style={{ height: 14 }} />
      ) : (
        <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 }}>{time}</Txt>
      )}

      <ActionSheet visible={menuOpen} title={author.displayName} actions={a.menu} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

function ActionIcon({ icon, color, label, onPress, selected, size }: {
  icon: IconName; color: string; label: string; onPress: () => void; selected?: boolean; size: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      style={({ pressed }) => [{ width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}
    >
      <Icon name={icon} size={size} color={color} strokeWidth={2} />
    </Pressable>
  );
}

/** Car chip (stone) and road/spot chip (clay). 32 px tall with a 44 px hit area. */
export function PostChips({ post }: { post: Pick<Post, 'car' | 'spot'> }) {
  const { c } = useTheme();
  const { t } = useI18n();
  if (!post.car && !post.spot) return null;
  const carName = post.car ? `${post.car.make} ${post.car.model}`.trim() : '';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 10 }}>
      {post.car ? (
        <Chip icon="garage" bg={c.stoneSoft} fg={c.stoneText} text={carName} label={t('post.carChip', { name: carName })} onPress={() => router.push(`/car/${post.car!.id}`)} />
      ) : null}
      {post.spot ? (
        <Chip icon={post.spot.type === 'camp' ? 'tent' : 'trail'} bg={c.claySoft} fg={c.clayText} text={post.spot.name} label={t('post.spotChip', { name: post.spot.name })} onPress={() => router.push(`/spot/${post.spot!.id}`)} />
      ) : null}
    </View>
  );
}

function Chip({ icon, bg, fg, text, label, onPress }: { icon: IconName; bg: string; fg: string; text: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [{ height: 32, maxWidth: '100%', paddingLeft: 10, paddingRight: 12, borderRadius: 16, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', gap: 6 }, pressed && { opacity: 0.7 }]}
    >
      <Icon name={icon} size={16} color={fg} strokeWidth={2.2} />
      <Txt variant="footnote" color={fg} style={{ fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{text}</Txt>
    </Pressable>
  );
}
