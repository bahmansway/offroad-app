import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { RequireAuth } from '../../components/RequireAuth';
import {
  ChoicePills, Cell, ErrorState, FormError, LoadingState as Loading, NavScreen, PillButton, Section, SegmentedControl,
  SwitchCell, TextField, Txt, goBack,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useAsync } from '../../lib/useAsync';
import { errorMessage } from '../../lib/errors';
import { confirmAsync } from '../../lib/dialogs';
import { useAuth } from '../../lib/auth';
import { NotOwner } from '../../components/NotOwner';
import { sameId, CURRENCIES, formatNumber, isValidPrice, parsePriceInput } from '../../lib/format';
import { between } from '../../lib/validation';
import { MOD_CATEGORIES, type Currency, type ModCategory } from '../../lib/types';

/** Add (no modId) or edit (modId) a modification of car `carId`. */
export default function ModScreen() {
  const { carId, modId } = useLocalSearchParams<{ carId: string; modId?: string }>();
  const { t, d, lang } = useI18n();
  const { user } = useAuth();
  const { data: car, error, loading, reload } = useAsync(() => api.car(carId), [carId]);
  const existing = modId ? car?.mods.find((m) => String(m.id) === String(modId)) : undefined;

  const [name, setName] = useState('');
  const [category, setCategory] = useState<ModCategory>('other');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<Currency>('AZN');
  const [pricePublic, setPricePublic] = useState(true);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setCategory(existing.category);
      setPrice(existing.price != null ? formatNumber(existing.price, lang).replace(/ /g, ' ') : '');
      setCurrency(existing.currency);
      setPricePublic(existing.pricePublic);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  const parsed = parsePriceInput(price);
  const errors = {
    name: between(name, 1, 80) ? null : t('mod.nameInvalid'),
    price: isValidPrice(parsed) ? null : t('mod.priceInvalid'),
  };

  async function submit() {
    setTouched(true);
    setFormError(null);
    if (errors.name || errors.price) return;
    setBusy(true);
    const body = { name: name.trim(), category, price: parsed, currency, pricePublic };
    try {
      if (existing) await api.updateMod(existing.id, body);
      else await api.addMod(carId, body);
      goBack(`/car/${carId}`);
    } catch (e) {
      setFormError(errorMessage(e, t, existing ? 'default' : 'create'));
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!(await confirmAsync(t('mod.deleteConfirm'), t('common.delete'), t('common.cancel')))) return;
    try {
      await api.deleteMod(existing.id);
      goBack(`/car/${carId}`);
    } catch (e) {
      setFormError(errorMessage(e, t));
    }
  }

  if (loading) return <Loading />;
  if (error || !car || (modId && !existing)) return <ErrorState message={errorMessage(error, t)} onRetry={reload} />;

  return (
    <RequireAuth>
      {!sameId(user?.id, car.owner.id) ? <NotOwner fallback={`/car/${carId}`} /> : (
      <NavScreen title={existing ? t('mod.editTitle') : t('mod.addTitle')} backLabel={t('common.cancel')} fallback={`/car/${carId}`}>
        <TextField label={t('mod.name')} placeholder={t('mod.namePlaceholder')} value={name} onChangeText={setName} maxLength={80} error={touched ? errors.name : null} />

        <View style={{ gap: 6, marginHorizontal: -16 }}>
          <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 36, textTransform: 'uppercase', letterSpacing: 0.2 }}>{t('mod.category')}</Txt>
          <ChoicePills
            label={t('mod.category')}
            value={category}
            onChange={setCategory}
            scroll={false}
            options={MOD_CATEGORIES.map((c) => ({ value: c, label: d.mod.categories[c] }))}
          />
        </View>

        <TextField
          label={`${t('mod.price')} (${t('common.optional')})`}
          placeholder={t('mod.pricePlaceholder')}
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          inputMode="decimal"
          maxLength={16}
          suffix={currency}
          error={touched ? errors.price : null}
        />
        <View style={{ gap: 6 }}>
          <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.2 }}>{t('mod.currency')}</Txt>
          <SegmentedControl label={t('mod.currency')} value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} style={{ alignSelf: 'stretch' }} />
        </View>
        <Section footer={t('mod.pricePublicHint')}>
          <SwitchCell title={t('mod.pricePublic')} value={pricePublic} onValueChange={setPricePublic} />
        </Section>

        <FormError message={formError} />
        <PillButton title={t('common.save')} onPress={submit} loading={busy} />
        {existing ? (
          <Section>
            <Cell title={t('common.delete')} destructive center chevron={false} onPress={remove} />
          </Section>
        ) : null}
      </NavScreen>
      )}
    </RequireAuth>
  );
}
