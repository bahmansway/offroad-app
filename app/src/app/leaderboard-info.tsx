import React from 'react';
import { View } from 'react-native';
import { Card, IconTile, SheetScreen, Txt, goBack } from '../components/ui';
import type { IconName } from '../components/ui/Icon';
import type { TerrainTone } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import { POINT_RULES as R } from '../lib/leaderboardLogic';

/** "Xallar necə qazanılır?" — the exact scoreboard rules (same numbers as the server). */
export default function LeaderboardInfo() {
  const { t } = useI18n();
  const rules: { icon: IconName; tone: TerrainTone; text: string }[] = [
    { icon: 'trail', tone: 'clay', text: t('board.rules.spot', { points: R.spot, hours: R.spotMinAgeHours, max: R.spotsPerMonth, reporters: R.spotReportersToDrop }) },
    { icon: 'events', tone: 'sand', text: t('board.rules.organized', { points: R.organized, max: R.organizedPerMonth }) },
    { icon: 'car', tone: 'sand', text: t('board.rules.attended', { points: R.attended, max: R.attendedPerMonth }) },
    { icon: 'clock', tone: 'sand', text: t('board.rules.eventRule', { minutes: R.minEventMinutes, cars: R.minCarsGoing }) },
    { icon: 'camera', tone: 'stone', text: t('board.rules.car', { points: R.car, max: R.carsCounted }) },
    { icon: 'star', tone: 'forest', text: t('board.rules.rating', { points: R.rating, max: R.ratingsPerMonth }) },
    { icon: 'calendarSmall', tone: 'stone', text: t('board.rules.months') },
  ];
  return (
    <SheetScreen title={t('board.howTitle')} cancelLabel={t('common.close')} onBack={() => goBack('/leaderboard')}>
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <Card style={{ gap: 16 }}>
          {rules.map((r) => (
            <View key={r.text} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }} accessible accessibilityLabel={r.text}>
              <IconTile icon={r.icon} tone={r.tone} size={32} />
              <Txt variant="subhead" style={{ flex: 1 }}>{r.text}</Txt>
            </View>
          ))}
        </Card>
        <Txt variant="footnote" tone="label2" center>{t('board.updated')}</Txt>
      </View>
    </SheetScreen>
  );
}
