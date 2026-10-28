import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Screen, TopBar, goBack } from '../../components/Screen';
import { RequireAuth } from '../../components/RequireAuth';
import { Button, ErrorState, FormError, Loading, Segmented, SwitchRow, TextField, s as ui } from '../../components/ui';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useAsync } from '../../lib/useAsync';
import { errorMessage } from '../../lib/errors';
import { confirmAsync } from '../../lib/dialogs';
import { useAuth } from '../../lib/auth';
import { NotOwner } from '../../components/NotOwner';
import { sameId, CURRENCIES, formatNumber, isValidPrice, parsePriceInput } from '../../lib/format';
import { between } from '../../lib/validation';
import { colors, fonts, radius } from '../../lib/theme';
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
      <Screen>
        <TopBar title={existing ? t('mod.editTitle') : t('mod.addTitle')} fallback={`/car/${carId}`} />
        <TextField label={t('mod.name')} placeholder={t('mod.namePlaceholder')} value={name} onChangeText={setName} maxLength={80} error={touched ? errors.name : null} />

        <View style={ui.field}>
          <Text style={ui.label}>{t('mod.category')}</Text>
          <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={t('mod.category')}>
            {MOD_CATEGORIES.map((c) => {
              const on = c === category;
              return (
                <Pressable
                  key={c}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setCategory(c)}
                  style={[styles.cat, on ? styles.catOn : styles.catOff]}
                >
                  <Text style={[styles.catText, on && { color: colors.onAccent }]}>{d.mod.categories[c]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <TextField
          label={`${t('mod.price')} (${t('common.optional')})`}
          placeholder={t('mod.pricePlaceholder')}
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          inputMode="decimal"
          maxLength={16}
          error={touched ? errors.price : null}
        />
        <Segmented
          label={t('mod.currency')}
          value={currency}
          onChange={setCurrency}
          options={CURRENCIES.map((c) => ({ value: c, label: c }))}
        />
        <SwitchRow label={t('mod.pricePublic')} hint={t('mod.pricePublicHint')} value={pricePublic} onValueChange={setPricePublic} />

        <FormError message={formError} />
        <Button title={t('common.save')} onPress={submit} loading={busy} />
        {existing ? <Button title={t('common.delete')} icon="trash" variant="danger" onPress={remove} /> : null}
      </Screen>
      )}
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cat: { minHeight: 44, paddingHorizontal: 14, borderRadius: radius.md, justifyContent: 'center', borderWidth: 1 },
  catOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  catOff: { backgroundColor: colors.surface, borderColor: colors.line },
  catText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
});
