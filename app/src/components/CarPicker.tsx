import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useI18n } from '../lib/i18n';
import type { CarSummary, Id } from '../lib/types';
import { sameId } from '../lib/format';
import { EVENT_LIMITS } from '../lib/eventLogic';
import { Cell, Section } from './ui/List';
import { Thumb } from './ui/Avatar';
import { PillButton } from './ui/Button';
import { LoadingState } from './ui/States';
import { Txt } from './ui/Text';
import { carTitle, photoUri } from './Rows';
import { Stepper } from './Stepper';

/** "Your car" radio list + passengers stepper, used when creating and joining an event. */
export function CarAndSeats({ cars, carId, onCar, seats, onSeats, header, footer, error }: {
  cars: CarSummary[] | null | undefined;
  carId: Id | null;
  onCar: (id: Id) => void;
  seats: number;
  onSeats: (n: number) => void;
  header: string;
  footer?: string;
  error?: string | null;
}) {
  const { t } = useI18n();
  if (cars === undefined || cars === null) return <LoadingState inline />;
  if (!cars.length) {
    return (
      <View style={{ gap: 10 }}>
        <Txt variant="subhead" tone="label2" center>{t('events.needCar')}</Txt>
        <PillButton title={t('events.addCar')} icon="plus" variant="tinted" onPress={() => router.push('/car/add')} />
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <Section header={header} footer={footer}>
        {cars.map((car) => (
          <Cell
            key={car.id}
            title={carTitle(car)}
            subtitle={String(car.year)}
            left={<Thumb seed={car.id} uri={photoUri(car.photoUrl)} size={40} />}
            checked={sameId(car.id, carId)}
            accessibilityRole="radio"
            onPress={() => onCar(car.id)}
          />
        ))}
      </Section>
      {error ? <Txt variant="footnote" tone="destructive" style={{ paddingHorizontal: 20 }} role="alert">{error}</Txt> : null}
      <Section>
        <Cell
          title={t('events.seats')}
          subtitle={t('events.seatsHint')}
          right={
            <Stepper
              value={seats}
              onChange={onSeats}
              min={0}
              max={EVENT_LIMITS.seatsMax}
              label={t('events.seats')}
              valueText={t('events.seatsValue', { count: seats })}
              minusLabel={t('events.seatsMinus')}
              plusLabel={t('events.seatsPlus')}
            />
          }
        />
      </Section>
    </View>
  );
}
