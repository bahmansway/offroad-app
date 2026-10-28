import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SpotForm } from '../../../components/SpotForm';
import { RequireAuth } from '../../../components/RequireAuth';
import { ErrorState, LoadingState as Loading } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n';
import { useAsync } from '../../../lib/useAsync';
import { errorMessage } from '../../../lib/errors';
import { useAuth } from '../../../lib/auth';
import { sameId } from '../../../lib/format';
import { NotOwner } from '../../../components/NotOwner';
import { goBack } from '../../../components/ui';

export default function EditSpotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.spot(id), [id]);
  return (
    <RequireAuth>
      {loading ? <Loading /> : error || !data ? <ErrorState message={errorMessage(error, t)} onRetry={reload} /> : !sameId(user?.id, data.owner.id) ? <NotOwner fallback={`/spot/${id}`} /> : (
        <SpotForm
          initial={data}
          title={t('spot.editTitle')}
          submitLabel={t('common.save')}
          onSubmit={async (input) => {
            await api.updateSpot(id, input);
            goBack(`/spot/${id}`);
          }}
        />
      )}
    </RequireAuth>
  );
}
