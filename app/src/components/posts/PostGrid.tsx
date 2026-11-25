import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from '../ui/Icon';
import { SectionHeader } from '../ui/Screen';
import { ActionSheet } from '../ActionSheet';
import { photoUri } from '../Rows';
import { usePostActions } from './usePostActions';
import { useTheme } from '../../lib/themeContext';
import { useI18n } from '../../lib/i18n';
import { tapFeedback } from '../../lib/haptics';
import { radius } from '../../lib/theme';
import type { Page, Post } from '../../lib/types';

/** 3-column square grid (profile). Stack icon on posts with several photos. Own posts: long-press → edit / delete. */
export function PostGrid({ posts, width, onPatch, onRemoved }: {
  posts: Post[]; width: number; onPatch: (id: Post['id'], p: Partial<Post>) => void; onRemoved: (id: Post['id']) => void;
}) {
  const size = Math.floor((width - 4) / 3);
  if (!(size > 0)) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }} accessibilityRole="list">
      {posts.map((p, i) => (
        <Tile key={p.id} post={p} n={i + 1} size={size} onPatch={(x) => onPatch(p.id, x)} onRemoved={() => onRemoved(p.id)} />
      ))}
    </View>
  );
}

function Tile({ post, n, size, onPatch, onRemoved }: { post: Post; n: number; size: number; onPatch: (p: Partial<Post>) => void; onRemoved: () => void }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const a = usePostActions(post, onPatch, onRemoved);
  const [menu, setMenu] = useState(false);
  const multi = post.photos.length > 1;
  const label = [t('profile.postN', { n }), multi ? t('profile.multiPhoto') : null, post.caption ? post.caption.slice(0, 80) : null].filter(Boolean).join(', ');
  return (
    <>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        accessibilityActions={a.mine ? [{ name: 'longpress', label: t('post.menu') }] : undefined}
        onAccessibilityAction={() => setMenu(true)}
        onPress={() => router.push(`/post/${post.id}`)}
        onLongPress={a.mine ? () => { tapFeedback(); setMenu(true); } : undefined}
        style={({ pressed }) => [{ width: size, height: size, backgroundColor: c.fill }, pressed && { opacity: 0.8 }]}
      >
        {post.photos[0] ? <Image source={{ uri: photoUri(post.photos[0].url) ?? undefined }} style={{ width: size, height: size }} resizeMode="cover" accessible={false} /> : null}
        {multi ? (
          <View style={{ position: 'absolute', right: 7, top: 7, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }} pointerEvents="none">
            <Icon name="stack" size={18} color="#FFFFFF" strokeWidth={2.2} svgOnly />
          </View>
        ) : null}
      </Pressable>
      {a.mine ? <ActionSheet visible={menu} actions={a.menu} onClose={() => setMenu(false)} /> : null}
    </>
  );
}

/**
 * Horizontal strip of post photos (spot page "Bu yoldan şəkillər", car page). Loads the first page itself
 * and hides when there are none.
 */
export function PostStrip({ title, load, reloadKey }: { title: string; load: () => Promise<Page<Post>>; reloadKey?: unknown }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const [posts, setPosts] = useState<Post[] | null>(null);
  useEffect(() => {
    let live = true;
    load().then((r) => { if (live) setPosts(r.items.filter((p) => p.photos.length > 0)); }).catch(() => { if (live) setPosts([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);
  if (!posts || posts.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <SectionHeader title={title} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}>
        {posts.map((p, i) => (
          <Pressable
            key={p.id}
            accessibilityRole="link"
            accessibilityLabel={`${t('post.a11y', { name: p.author.displayName, time: '' }).replace(/,\s*$/, '')}, ${t('profile.postN', { n: i + 1 })}`}
            onPress={() => router.push(`/post/${p.id}`)}
            style={({ pressed }) => [{ width: 112, height: 112, borderRadius: radius.thumb, overflow: 'hidden', backgroundColor: c.fill }, pressed && { opacity: 0.8 }]}
          >
            <Image source={{ uri: photoUri(p.photos[0].url) ?? undefined }} style={{ width: 112, height: 112 }} resizeMode="cover" accessible={false} />
            {p.photos.length > 1 ? (
              <View style={{ position: 'absolute', right: 6, top: 6 }} pointerEvents="none">
                <Icon name="stack" size={16} color="#FFFFFF" strokeWidth={2.2} svgOnly />
              </View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
