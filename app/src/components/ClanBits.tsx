import React from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { useI18n } from '../lib/i18n';
import { tints } from '../lib/theme';
import type { Clan } from '../lib/types';
import { hashSeed } from './ui/Avatar';
import { Badge } from './ui/Controls';
import { Cell } from './ui/List';
import { Txt } from './ui/Text';
import { photoUri } from './Rows';

/** Clan logo: the photo, or the tag on an earthy colour tile. Rounded square like an app icon. */
export function ClanLogo({ clan, size = 46, style }: {
  clan: { id: string | number; tag: string; logoUrl?: string | null }; size?: number; style?: StyleProp<ViewStyle>;
}) {
  const uri = photoUri(clan.logoUrl);
  const r = Math.round(size * 0.26);
  return (
    <View
      style={[{ width: size, height: size, borderRadius: r, overflow: 'hidden', backgroundColor: tints[hashSeed(clan.id) % tints.length], alignItems: 'center', justifyContent: 'center' }, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <Txt color="#FFFFFF" numberOfLines={1} style={{ fontWeight: '700', fontSize: Math.round(size * (clan.tag.length > 3 ? 0.26 : 0.34)), letterSpacing: 0.5 }}>
          {clan.tag}
        </Txt>
      )}
    </View>
  );
}

/** "[DMR] · Bakı · 12 üzv" */
export function clanMeta(clan: Clan, t: (k: string, p?: Record<string, string | number>) => string) {
  return [`[${clan.tag}]`, clan.city, t('clan.memberCount', { count: clan.memberCount })].filter(Boolean).join(' · ');
}

/** Grouped-list row for a clan. */
export function ClanCell({ clan, onPress, last }: { clan: Clan; onPress: () => void; last?: boolean }) {
  const { t } = useI18n();
  const meta = clanMeta(clan, t);
  const badge = clan.myRole === 'leader' ? t('clan.leader')
    : clan.myRole === 'member' ? t('clan.member')
      : clan.myRole === 'pending' ? t('clan.request')
        : clan.isOpen ? t('clan.open') : t('clan.request');
  return (
    <Cell
      title={clan.name}
      subtitle={meta}
      left={<ClanLogo clan={clan} />}
      right={<Badge text={badge} tone={clan.myRole ? 'tint' : 'gray'} />}
      onPress={onPress}
      minHeight={64}
      accessibilityRole="link"
      accessibilityLabel={`${clan.name}, ${meta}, ${badge}`}
      last={last}
    />
  );
}
