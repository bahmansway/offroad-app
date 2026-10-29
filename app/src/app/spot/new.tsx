import React from 'react';
import { router } from 'expo-router';
import { SpotForm } from '../../components/SpotForm';
import { RequireAuth } from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { successFeedback } from '../../lib/haptics';

export default function NewSpotScreen() {
  const { t } = useI18n();
  return (
    <RequireAuth>
      <SpotForm
        title={t('addSpot.title')}
        submitLabel={t('addSpot.save')}
        onSubmit={async (input) => {
          const spot = await api.createSpot(input);
          successFeedback();
          router.replace(`/spot/${spot.id}`);
        }}
      />
    </RequireAuth>
  );
}
