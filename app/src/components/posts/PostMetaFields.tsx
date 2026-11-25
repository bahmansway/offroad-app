import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Cell, IconTile, Section, Thumb, Txt, useTheme } from '../ui';
import { PickerModal } from '../PickerModal';
import { photoUri } from '../Rows';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import type { CarSummary, Id, Spot } from '../../lib/types';

export interface MetaValue {
  car: { id: Id; label: string } | null;
  spot: { id: Id; label: string } | null;
}

/** "Maşın seç" (my own cars) and "Yol/Spot seç" (search any spot) rows for a post, with the GPS note. */
export function PostMetaFields({ value, onChange }: { value: MetaValue; onChange: (v: MetaValue) => void }) {
  const { t } = useI18n();
  const { c } = useTheme();
  const { user } = useAuth();
  const [open, setOpen] = useState<'car' | 'spot' | null>(null);
  const [cars, setCars] = useState<CarSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [spots, setSpots] = useState<Spot[] | null>(null);

  useEffect(() => {
    if (open === 'car' && cars === null && user) api.cars(user.id).then((r) => setCars(r.items)).catch(() => setCars([]));
  }, [open, cars, user]);
  useEffect(() => {
    if (open !== 'spot') return;
    let live = true;
    const h = setTimeout(() => {
      api.spots({ q: q.trim() || undefined }).then((r) => { if (live) setSpots(r.items.slice(0, 50)); }).catch(() => { if (live) setSpots([]); });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [open, q]);

  return (
    <View style={{ gap: 8 }}>
      <Section>
        <Cell
          title={t('post.new.chooseCar')}
          subtitle={value.car?.label ?? t('post.new.optional')}
          left={<IconTile icon="garage" bg={c.stone} size={40} />}
          onPress={() => setOpen('car')}
          minHeight={64}
        />
        <Cell
          title={t('post.new.chooseSpot')}
          subtitle={value.spot?.label ?? t('post.new.optional')}
          left={<IconTile icon="trail" bg={c.clay} size={40} />}
          onPress={() => setOpen('spot')}
          minHeight={64}
        />
      </Section>
      <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 16 }}>{t('post.new.spotHint')}</Txt>

      <PickerModal
        visible={open === 'car'}
        title={t('post.new.chooseCar')}
        noneLabel={t('post.new.noCar')}
        selected={value.car ? String(value.car.id) : null}
        loading={cars === null}
        emptyText={t('post.new.noCars')}
        rows={(cars ?? []).map((car) => ({ id: String(car.id), title: `${car.make} ${car.model}`, subtitle: String(car.year), left: <Thumb kind="car" uri={photoUri(car.photoUrl)} size={40} /> }))}
        onPick={(id) => {
          const car = cars?.find((x) => String(x.id) === id);
          onChange({ ...value, car: car ? { id: car.id, label: `${car.make} ${car.model} · ${car.year}` } : null });
          setOpen(null);
        }}
        onClose={() => setOpen(null)}
      />
      <PickerModal
        visible={open === 'spot'}
        title={t('post.new.chooseSpot')}
        noneLabel={t('post.new.noSpot')}
        selected={value.spot ? String(value.spot.id) : null}
        search={q}
        onSearch={setQ}
        searchLabel={t('post.new.searchSpots')}
        loading={spots === null}
        emptyText={t('post.new.noSpots')}
        rows={(spots ?? []).map((s) => ({ id: String(s.id), title: s.name, subtitle: s.type === 'camp' ? t('spot.camp') : `${t('spot.trail')}${s.difficulty ? ` · ${s.difficulty}` : ''}`, left: <Thumb kind={s.type === 'camp' ? 'camp' : 'trail'} size={40} /> }))}
        onPick={(id) => {
          const s = spots?.find((x) => String(x.id) === id);
          onChange({ ...value, spot: s ? { id: s.id, label: s.name } : null });
          setOpen(null);
        }}
        onClose={() => setOpen(null)}
      />
    </View>
  );
}
