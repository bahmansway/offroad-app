import React, { useState } from 'react';
import { Screen, TopBar } from './Screen';
import { Button, FormError, TextField } from './ui';
import { useI18n } from '../lib/i18n';
import { errorMessage } from '../lib/errors';
import { between, maxCarYear } from '../lib/validation';
import type { Car, CarInput } from '../lib/types';

export function CarForm({ initial, title, onSubmit }: {
  initial?: Car; title: string; onSubmit: (input: CarInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const [make, setMake] = useState(initial?.make ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [year, setYear] = useState(initial ? String(initial.year) : '');
  const [engine, setEngine] = useState(initial?.engine ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const max = maxCarYear();
  const y = Number(year);
  const errors = {
    make: between(make, 1, 40) ? null : t('garage.makeInvalid'),
    model: between(model, 1, 60) ? null : t('garage.modelInvalid'),
    year: /^\d{4}$/.test(year.trim()) && y >= 1950 && y <= max ? null : t('garage.yearInvalid', { max }),
    engine: engine.trim().length <= 40 ? null : t('garage.engineTooLong'),
    description: description.trim().length <= 1000 ? null : t('garage.descriptionTooLong'),
  };
  const err = (k: keyof typeof errors) => (touched ? errors[k] : null);

  async function submit() {
    setTouched(true);
    setFormError(null);
    if (Object.values(errors).some(Boolean)) return;
    setBusy(true);
    try {
      await onSubmit({
        make: make.trim(),
        model: model.trim(),
        year: y,
        engine: engine.trim() || null,
        description: description.trim() || null,
      });
    } catch (e) {
      setFormError(errorMessage(e, t, initial ? 'default' : 'create'));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar title={title} fallback="/garage" />
      <TextField label={t('garage.make')} placeholder={t('garage.makePlaceholder')} value={make} onChangeText={setMake} maxLength={40} error={err('make')} />
      <TextField label={t('garage.model')} placeholder={t('garage.modelPlaceholder')} value={model} onChangeText={setModel} maxLength={60} error={err('model')} />
      <TextField label={t('garage.year')} value={year} onChangeText={(v) => setYear(v.replace(/\D/g, ''))} keyboardType="number-pad" inputMode="numeric" maxLength={4} error={err('year')} />
      <TextField label={`${t('garage.engine')} (${t('common.optional')})`} placeholder={t('garage.enginePlaceholder')} value={engine} onChangeText={setEngine} maxLength={40} error={err('engine')} />
      <TextField label={`${t('garage.description')} (${t('common.optional')})`} value={description} onChangeText={setDescription} multiline maxLength={1000} error={err('description')} />
      <FormError message={formError} />
      <Button title={t('common.save')} onPress={submit} loading={busy} />
    </Screen>
  );
}
