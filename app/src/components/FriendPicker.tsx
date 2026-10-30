import React, { useState } from 'react';
import { View } from 'react-native';
import { SearchField, Section, Txt } from './ui';
import { PersonCell } from './ChatRows';
import { useI18n } from '../lib/i18n';
import { filterByName } from '../lib/friendsLogic';
import { selectionFeedback } from '../lib/haptics';
import { togglePick } from '../lib/groupLogic';
import { sameId } from '../lib/format';
import type { FriendItem, Id } from '../lib/types';

/** Tick friends for a group, up to `max`. Shows "3 of 19 picked" and a note when full. */
export function FriendPicker({ friends, selected, onChange, max }: {
  friends: FriendItem[]; selected: Id[]; onChange: (ids: Id[]) => void; max: number;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [fullNote, setFullNote] = useState(false);
  const shown = filterByName(friends, q);
  return (
    <View style={{ gap: 12 }}>
      {friends.length > 8 ? <SearchField value={q} onChangeText={setQ} placeholder={t('friends.search')} label={t('friends.search')} /> : null}
      <Section
        header={t('group.pickFriends')}
        right={<Txt variant="footnote" tone="label2" accessibilityLiveRegion="polite">{t('group.picked', { count: selected.length, max })}</Txt>}
      >
        {shown.map((f) => {
          const on = selected.some((x) => sameId(x, f.user.id));
          return (
            <PersonCell
              key={f.user.id}
              user={f.user}
              checked={on}
              onPress={() => {
                const r = togglePick(selected, f.user.id, max);
                setFullNote(r.full && r.selected === selected);
                if (r.selected !== selected) selectionFeedback();
                onChange(r.selected);
              }}
              accessibilityLabel={f.user.displayName}
            />
          );
        })}
      </Section>
      {fullNote ? <Txt variant="footnote" tone="destructive" center role="alert">{t('group.pickedFull', { max })}</Txt> : null}
    </View>
  );
}
