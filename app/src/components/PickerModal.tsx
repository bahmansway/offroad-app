import React from 'react';
import { Modal, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavBar } from './ui/Screen';
import { SearchField } from './ui/Controls';
import { Section, Cell } from './ui/List';
import { LoadingState, EmptyState } from './ui/States';
import { useTheme } from '../lib/themeContext';
import { useI18n } from '../lib/i18n';
import { radius } from '../lib/theme';

export interface PickerRow { id: string; title: string; subtitle?: string; left?: React.ReactNode }

/** Full-height chooser sheet (car / road for a post): optional search, a "none" row, the rows with a tick. */
export function PickerModal({ visible, title, rows, selected, onPick, onClose, noneLabel, search, onSearch, searchLabel, loading, emptyText }: {
  visible: boolean; title: string; rows: PickerRow[]; selected: string | null; onPick: (id: string | null) => void; onClose: () => void;
  noneLabel: string; search?: string; onSearch?: (s: string) => void; searchLabel?: string; loading?: boolean; emptyText?: string;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined} transparent={Platform.OS !== 'ios'} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Platform.OS === 'ios' ? c.bg : c.behind, paddingTop: Platform.OS === 'ios' ? 0 : insets.top + 10 }}>
        <View style={{ flex: 1, backgroundColor: c.bg, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, overflow: 'hidden' }} accessibilityViewIsModal>
          <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: c.grabber, alignSelf: 'center', marginTop: 8 }} />
          <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center' }}>
            <NavBar title={title} cancelLabel={t('common.cancel')} onBack={onClose} />
          </View>
          <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 640, alignSelf: 'center', padding: 16, gap: 16, paddingBottom: 24 + insets.bottom }} keyboardShouldPersistTaps="handled">
            {onSearch ? <SearchField value={search ?? ''} onChangeText={onSearch} placeholder={searchLabel ?? ''} label={searchLabel ?? ''} /> : null}
            <Section>
              <Cell title={noneLabel} checked={selected === null} onPress={() => onPick(null)} accessibilityRole="radio" />
              {rows.map((r) => (
                <Cell key={r.id} title={r.title} subtitle={r.subtitle} left={r.left} checked={selected === r.id} onPress={() => onPick(r.id)} accessibilityRole="radio" minHeight={60} />
              ))}
            </Section>
            {loading ? <LoadingState inline /> : !rows.length && emptyText ? <EmptyState icon="search" title={emptyText} contour={false} style={{ paddingVertical: 12 }} /> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
