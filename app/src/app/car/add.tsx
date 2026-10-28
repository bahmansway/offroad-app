import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, View } from 'react-native';
import { router } from 'expo-router';
import { RequireAuth } from '../../components/RequireAuth';
import { CarForm } from '../../components/CarForm';
import {
  Card, Cell, ChoicePills, EmptyState, ErrorState, FormError, LinkButton, LoadingState, PillButton, SearchField,
  Icon, Section, SheetScreen, Txt, goBack, useTheme,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import { HAIRLINE, radius } from '../../lib/theme';
import { pickPhoto } from '../../lib/photos';
import { successFeedback } from '../../lib/haptics';
import {
  brandMonogram, carInputFromTrim, defaultYear, groupBrands, powerUnitLabel, splitModels, trimsForYear, trimSummary, yearOptions,
} from '../../lib/catalog';
import type { CatalogBrand, CatalogModel, Trim } from '../../lib/types';

type Step = 'brand' | 'model' | 'trim' | 'specs' | 'manual';

/** Add car (modal sheet): brand → model → year + trim → auto-filled specs → save. "Enter manually" anywhere. */
export default function AddCarScreen() {
  return (
    <RequireAuth>
      <AddCarFlow />
    </RequireAuth>
  );
}

function AddCarFlow() {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('brand');
  const [brand, setBrand] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [trim, setTrim] = useState<Trim | null>(null);

  const close = () => goBack('/garage');
  const manual = () => setStep('manual');

  if (step === 'manual') {
    return (
      <CarForm
        title={t('addCar.manualTitle')}
        backLabel={t('common.back')}
        submitLabel={t('addCar.save')}
        initial={brand && model && year ? carInputFromTrim(brand, model, year, trim) : { make: brand ?? '', model: model ?? '' }}
        onSubmit={async (input) => {
          const car = await api.createCar(input);
          successFeedback();
          router.replace(`/car/${car.id}`);
        }}
      />
    );
  }
  if (step === 'brand') {
    return <BrandStep onClose={close} onManual={manual} onPick={(b) => { setBrand(b); setModel(null); setTrim(null); setStep('model'); }} />;
  }
  if (step === 'model' && brand) {
    return <ModelStep brand={brand} onBack={() => setStep('brand')} onManual={manual} onPick={(m) => { setModel(m); setTrim(null); setYear(null); setStep('trim'); }} />;
  }
  if (step === 'trim' && brand && model) {
    return (
      <TrimStep
        brand={brand}
        model={model}
        year={year}
        trim={trim}
        onYear={(y) => { setYear(y); setTrim(null); }}
        onBack={() => setStep('model')}
        onManual={manual}
        onPick={(tr) => { setTrim(tr); setStep('specs'); }}
      />
    );
  }
  if (step === 'specs' && brand && model && year) {
    return <SpecsStep brand={brand} model={model} year={year} trim={trim} onBack={() => setStep('trim')} onManual={manual} />;
  }
  return <LoadingState />;
}

function StepFooterManual({ onManual }: { onManual: () => void }) {
  const { t } = useI18n();
  return <LinkButton title={t('addCar.manual')} onPress={onManual} style={{ alignSelf: 'center' }} />;
}

// ---------- step 1: brand ----------
function BrandStep({ onPick, onClose, onManual }: { onPick: (b: string) => void; onClose: () => void; onManual: () => void }) {
  const { t } = useI18n();
  const [brands, setBrands] = useState<CatalogBrand[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState('');
  const load = useCallback(() => {
    setError(null);
    api.catalogBrands().then(setBrands).catch(setError);
  }, []);
  useEffect(load, [load]);
  const groups = useMemo(() => groupBrands(brands ?? [], q), [brands, q]);
  const row = (b: CatalogBrand) => (
    <Cell
      key={b.name}
      title={b.name}
      left={<Mono text={brandMonogram(b.name)} />}
      onPress={() => onPick(b.name)}
    />
  );
  return (
    <SheetScreen title={t('addCar.title')} subtitle={t('addCar.step', { n: 1 })} cancelLabel={t('common.cancel')} onBack={onClose}>
      <Txt variant="largeTitle" accessibilityRole="header" style={{ paddingHorizontal: 20 }}>{t('addCar.brandTitle')}</Txt>
      <SearchField value={q} onChangeText={setQ} placeholder={t('addCar.brandSearch')} label={t('addCar.brandSearch')} style={{ marginHorizontal: 16 }} />
      {error ? <ErrorState message={`${t('addCar.catalogFailed')} ${errorMessage(error, t)}`} onRetry={load} /> : null}
      {!brands && !error ? <LoadingState inline /> : null}
      {brands && q && groups.all.length === 0 ? <EmptyState icon="search" title={t('addCar.noResults', { q })} /> : null}
      <View style={{ paddingHorizontal: 16, gap: 22 }}>
        {groups.popular.length ? (
          <Section header={t('addCar.popular')} footer={t('addCar.allBrandsHint')}>{groups.popular.map(row)}</Section>
        ) : null}
        {groups.all.length ? <Section header={q ? undefined : t('addCar.allBrands')}>{groups.all.map(row)}</Section> : null}
      </View>
      <StepFooterManual onManual={onManual} />
    </SheetScreen>
  );
}

function Mono({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }} accessible={false}>
      <Txt variant="footnote" tone="label2" style={{ fontWeight: '700' }}>{text}</Txt>
    </View>
  );
}

// ---------- step 2: model ----------
function ModelStep({ brand, onPick, onBack, onManual }: { brand: string; onPick: (m: string) => void; onBack: () => void; onManual: () => void }) {
  const { t } = useI18n();
  const [models, setModels] = useState<CatalogModel[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState('');
  const load = useCallback(() => {
    setError(null);
    setModels(null);
    api.catalogModels(brand).then(setModels).catch(setError);
  }, [brand]);
  useEffect(load, [load]);
  const { offroad, other } = useMemo(() => splitModels(models ?? [], q), [models, q]);
  const row = (m: CatalogModel) => <Cell key={m.name} title={m.name} onPress={() => onPick(m.name)} />;
  return (
    <SheetScreen title={brand} subtitle={t('addCar.step', { n: 2 })} backLabel={t('addCar.brandBack')} onBack={onBack}>
      <Txt variant="largeTitle" accessibilityRole="header" style={{ paddingHorizontal: 20 }}>{t('addCar.modelTitle')}</Txt>
      <SearchField value={q} onChangeText={setQ} placeholder={t('addCar.modelSearch', { brand })} label={t('addCar.modelSearch', { brand })} style={{ marginHorizontal: 16 }} />
      {error ? <ErrorState message={`${t('addCar.catalogFailed')} ${errorMessage(error, t)}`} onRetry={load} /> : null}
      {!models && !error ? <LoadingState inline /> : null}
      {models && offroad.length + other.length === 0 ? <EmptyState icon="search" title={t('addCar.noResults', { q: q || brand })} /> : null}
      <View style={{ paddingHorizontal: 16, gap: 22 }}>
        {offroad.length ? <Section header={t('addCar.offroadModels')}>{offroad.map(row)}</Section> : null}
        {other.length ? <Section header={t('addCar.otherModels')}>{other.map(row)}</Section> : null}
      </View>
      <StepFooterManual onManual={onManual} />
    </SheetScreen>
  );
}

// ---------- step 3: year + trim ----------
function TrimStep({ brand, model, year, trim, onYear, onPick, onBack, onManual }: {
  brand: string; model: string; year: number | null; trim: Trim | null; onYear: (y: number) => void;
  onPick: (t: Trim | null) => void; onBack: () => void; onManual: () => void;
}) {
  const { t, d } = useI18n();
  const [trims, setTrims] = useState<Trim[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    setTrims(null);
    api.catalogTrims(brand, model).then((list) => {
      setTrims(list);
      if (year == null) {
        const y = defaultYear(list) ?? new Date().getFullYear();
        onYear(y);
      }
    }).catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand, model]);
  useEffect(load, [load]);
  const years = useMemo(() => yearOptions(trims ?? []), [trims]);
  const forYear = useMemo(() => trimsForYear(trims ?? [], year), [trims, year]);
  const words = { hp: t('specs.hp'), transmission: d.specs.transmissions };
  return (
    <SheetScreen title={model} subtitle={t('addCar.step', { n: 3 })} backLabel={t('addCar.modelBack')} onBack={onBack}>
      <Txt variant="largeTitle" accessibilityRole="header" style={{ paddingHorizontal: 20 }}>{t('addCar.trimTitle')}</Txt>
      {error ? <ErrorState message={`${t('addCar.catalogFailed')} ${errorMessage(error, t)}`} onRetry={load} /> : null}
      {!trims && !error ? <LoadingState inline /> : null}
      {trims ? (
        <>
          <View style={{ gap: 8 }}>
            <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 36, textTransform: 'uppercase', letterSpacing: 0.2 }}>{t('addCar.yearHeader')}</Txt>
            <ChoicePills label={t('addCar.yearHeader')} value={year} onChange={onYear} options={years.map((y) => ({ value: y, label: String(y) }))} />
          </View>
          <View style={{ paddingHorizontal: 16 }}>
            {forYear.length ? (
              <Section header={year ? t('addCar.trimHeader', { year }) : undefined}>
                {forYear.map((tr) => (
                  <Cell
                    key={tr.id}
                    title={tr.engine}
                    subtitle={[tr.generation, trimSummary(tr, words)].filter(Boolean).join(' · ')}
                    checked={trim?.id === tr.id ? true : undefined}
                    chevron={trim?.id !== tr.id}
                    accessibilityRole="radio"
                    onPress={() => onPick(tr)}
                    minHeight={64}
                  />
                ))}
              </Section>
            ) : (
              <Card>
                <Txt variant="subhead" tone="label2">{t('addCar.noTrims')}</Txt>
                <PillButton title={t('addCar.continueNoTrim')} variant="tinted" size="medium" disabled={!year} onPress={() => onPick(null)} />
              </Card>
            )}
          </View>
        </>
      ) : null}
      <StepFooterManual onManual={onManual} />
    </SheetScreen>
  );
}

// ---------- step 4: specs + save ----------
function SpecsStep({ brand, model, year, trim, onBack, onManual }: {
  brand: string; model: string; year: number; trim: Trim | null; onBack: () => void; onManual: () => void;
}) {
  const { t, d } = useI18n();
  const { c } = useTheme();
  const [photo, setPhoto] = useState<{ bytes: Uint8Array; uri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function addPhoto() {
    setFormError(null);
    const res = await pickPhoto('car');
    if (res.ok) setPhoto({ bytes: res.bytes, uri: res.previewUri });
    else if (res.reason !== 'cancelled') setFormError(t(res.reason === 'denied' ? 'profile.photoDenied' : res.reason === 'tooBig' ? 'profile.photoTooBig' : 'profile.photoFailed'));
  }

  async function save() {
    setBusy(true);
    setFormError(null);
    try {
      const car = await api.createCar(carInputFromTrim(brand, model, year, trim));
      let photoFailed = false;
      if (photo) {
        try {
          await api.uploadCarPhoto(car.id, photo.bytes);
        } catch {
          photoFailed = true;
        }
      }
      successFeedback();
      router.replace({ pathname: '/car/[id]', params: { id: String(car.id), ...(photoFailed ? { notice: 'photo' } : {}) } });
    } catch (e) {
      setFormError(errorMessage(e, t, 'car'));
      setBusy(false);
    }
  }

  const rows = trim ? [
    { k: t('specs.engine'), v: trim.engine },
    { k: t('specs.transmission'), v: d.specs.transmissions[trim.transmission] ?? trim.transmission },
    { k: t('specs.fuel'), v: d.specs.fuels[trim.fuel] ?? trim.fuel },
  ] : [];

  return (
    <SheetScreen
      subtitle={t('addCar.step', { n: 4 })}
      backLabel={t('common.back')}
      onBack={onBack}
      footer={<PillButton title={t('addCar.save')} onPress={save} loading={busy} />}
    >
      <View style={{ paddingHorizontal: 20, gap: 4 }}>
        <Txt variant="largeTitle" accessibilityRole="header">{brand} {model}</Txt>
        <Txt tone="label2">{[String(year), trim?.engine].filter(Boolean).join(' · ')}</Txt>
      </View>
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <Card>
          {trim ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="check" size={18} color={c.tint} strokeWidth={2.6} />
                <Txt variant="subhead" tone="label2">{t('addCar.specsAuto')}</Txt>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <SpecTile k={t('specs.power')} v={String(trim.hp)} unit={powerUnitLabel(trim, t('specs.hp'))} />
                <SpecTile k={t('specs.drive')} v={trim.drive} />
              </View>
              <View>
                {rows.map((r, i) => (
                  <View key={r.k} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, gap: 12, borderBottomWidth: i === rows.length - 1 ? 0 : HAIRLINE, borderBottomColor: c.separator }}>
                    <Txt>{r.k}</Txt>
                    <Txt tone="label2" style={{ flexShrink: 1, textAlign: 'right' }}>{r.v}</Txt>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Txt variant="subhead" tone="label2">{t('addCar.specsManual')}</Txt>
          )}
        </Card>
        <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20 }}>{t('addCar.specsHint')}</Txt>
      </View>
      <View style={{ paddingHorizontal: 16 }}>
        <Section>
          <Cell
            title={photo ? t('addCar.changePhoto') : t('addCar.addPhoto')}
            action
            chevron={false}
            left={photo ? (
              <Image source={{ uri: photo.uri }} style={{ width: 46, height: 46, borderRadius: radius.thumb }} accessible={false} />
            ) : undefined}
            onPress={addPhoto}
          />
        </Section>
      </View>
      <FormError message={formError} />
      <StepFooterManual onManual={onManual} />
    </SheetScreen>
  );
}

function SpecTile({ k, v, unit }: { k: string; v: string; unit?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, borderRadius: radius.tile, backgroundColor: c.bg, paddingVertical: 12, paddingHorizontal: 14, gap: 2 }} accessible accessibilityLabel={`${k}: ${v}${unit ? ` ${unit}` : ''}`}>
      <Txt variant="footnote" tone="label2">{k}</Txt>
      <Txt style={{ fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.4 }}>
        {v}{unit ? <Txt variant="headline" tone="label2"> {unit}</Txt> : null}
      </Txt>
    </View>
  );
}
