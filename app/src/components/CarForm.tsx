import React, { useState } from 'react';
import { View } from 'react-native';
import { NavScreen } from './ui/Screen';
import { PillButton } from './ui/Button';
import { ChoicePills, TextField } from './ui/Controls';
import { FormError } from './ui/States';
import { Txt } from './ui/Text';
import { useI18n } from '../lib/i18n';
import { errorMessage } from '../lib/errors';
import { maxCarYear, parseDecimal, parseIntOrNull, validateCar, type CarFormValues } from '../lib/validation';
import { DRIVES, FUELS, TRANSMISSIONS, type Car, type CarInput, type Drive, type Fuel, type Transmission } from '../lib/types';

/** Turns form strings into the PATCH/POST body. Empty optional fields become null. */
export function carFormToInput(v: CarFormValues, trimId: string | null | undefined): CarInput {
  return {
    make: v.make.trim(),
    model: v.model.trim(),
    year: Number(v.year),
    engine: v.engine.trim() || null,
    engineL: parseDecimal(v.engineL),
    hp: parseIntOrNull(v.hp),
    drive: (v.drive as Drive | null) ?? null,
    transmission: (v.transmission as Transmission | null) ?? null,
    fuel: (v.fuel as Fuel | null) ?? null,
    color: v.color.trim() || null,
    description: v.description.trim() || null,
    trimId: trimId ?? null,
  };
}

export function initialCarValues(c?: Partial<Car> | null): CarFormValues {
  return {
    make: c?.make ?? '',
    model: c?.model ?? '',
    year: c?.year ? String(c.year) : '',
    engine: c?.engine ?? '',
    engineL: c?.engineL != null ? String(c.engineL) : '',
    hp: c?.hp != null ? String(c.hp) : '',
    drive: c?.drive ?? null,
    transmission: c?.transmission ?? null,
    fuel: c?.fuel ?? null,
    color: c?.color ?? '',
    description: c?.description ?? '',
  };
}

/** Full car form: make/model/year + all spec fields. Specs are optional and always editable. */
export function CarForm({ initial, title, onSubmit, backLabel, submitLabel }: {
  initial?: (Partial<Car> & Partial<CarInput>) | null; title: string; onSubmit: (input: CarInput) => Promise<void>;
  backLabel?: string; submitLabel?: string;
}) {
  const { t, d } = useI18n();
  const [v, setV] = useState<CarFormValues>(() => initialCarValues(initial));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof CarFormValues>(k: K) => (val: CarFormValues[K]) => setV((o) => ({ ...o, [k]: val }));

  const errs = validateCar(v);
  const err = (k: keyof typeof errs) => (touched && errs[k] ? t(errs[k]!, { max: maxCarYear() }) : null);
  // Changing a spec by hand means it no longer matches the catalog trim exactly — keep the link anyway
  // only while make/model/year are unchanged (the trim still describes this car).
  const keepTrim = initial?.trimId && initial.make === v.make.trim() && initial.model === v.model.trim() && String(initial.year) === v.year.trim();

  async function submit() {
    setTouched(true);
    setFormError(null);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    try {
      await onSubmit(carFormToInput(v, keepTrim ? initial?.trimId : null));
    } catch (e) {
      setFormError(errorMessage(e, t, initial?.id ? 'default' : 'car'));
      setBusy(false);
    }
  }

  const optional = (s: string) => `${s} (${t('common.optional')})`;
  return (
    <NavScreen title={title} backLabel={backLabel} fallback="/garage">
      <TextField label={t('garage.make')} placeholder={t('garage.makePlaceholder')} value={v.make} onChangeText={set('make')} maxLength={40} error={err('make')} />
      <TextField label={t('garage.model')} placeholder={t('garage.modelPlaceholder')} value={v.model} onChangeText={set('model')} maxLength={60} error={err('model')} />
      <TextField label={t('garage.year')} value={v.year} onChangeText={(s) => set('year')(s.replace(/\D/g, ''))} keyboardType="number-pad" inputMode="numeric" maxLength={4} error={err('year')} />

      <Txt variant="title2" accessibilityRole="header" style={{ paddingHorizontal: 4, marginTop: 4 }}>{t('specs.title')}</Txt>
      <TextField label={optional(t('specs.engine'))} placeholder={t('garage.enginePlaceholder')} value={v.engine} onChangeText={set('engine')} maxLength={40} error={err('engine')} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <TextField label={t('specs.engineL')} value={v.engineL} onChangeText={(s) => set('engineL')(s.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" inputMode="decimal" maxLength={4} suffix={t('specs.engineLUnit')} error={err('engineL')} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label={t('specs.power')} value={v.hp} onChangeText={(s) => set('hp')(s.replace(/\D/g, ''))} keyboardType="number-pad" inputMode="numeric" maxLength={4} suffix={t('specs.hp')} error={err('hp')} />
        </View>
      </View>
      <SpecChoice label={t('specs.drive')} value={v.drive} onChange={set('drive')} options={DRIVES.map((x) => ({ value: x, label: x }))} />
      <SpecChoice label={t('specs.transmission')} value={v.transmission} onChange={set('transmission')}
        options={TRANSMISSIONS.map((x) => ({ value: x, label: d.specs.transmissions[x] }))} />
      <SpecChoice label={t('specs.fuel')} value={v.fuel} onChange={set('fuel')} options={FUELS.map((x) => ({ value: x, label: d.specs.fuels[x] }))} wrap />
      <TextField label={optional(t('specs.color'))} placeholder={t('specs.colorPlaceholder')} value={v.color} onChangeText={set('color')} maxLength={30} error={err('color')} />
      <TextField label={optional(t('garage.description'))} value={v.description} onChangeText={set('description')} multiline maxLength={1000} error={err('description')} />
      <FormError message={formError} />
      <PillButton title={submitLabel ?? t('common.save')} onPress={submit} loading={busy} />
    </NavScreen>
  );
}

/** Pill choice row that includes "not set". Scrolls sideways when the words are long. */
function SpecChoice({ label, value, onChange, options }: {
  label: string; value: string | null; onChange: (v: string | null) => void; options: { value: string; label: string }[]; wrap?: boolean;
}) {
  const { t } = useI18n();
  const opts = [{ value: '', label: t('specs.notSet') }, ...options];
  return (
    <View style={{ gap: 6, marginHorizontal: -16 }}>
      <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 36, textTransform: 'uppercase', letterSpacing: 0.2 }}>{label}</Txt>
      <ChoicePills label={label} value={value ?? ''} onChange={(x) => onChange(x === '' ? null : x)} options={opts} />
    </View>
  );
}
