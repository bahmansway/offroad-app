import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { CarForm } from '../../../components/CarForm';
import { RequireAuth } from '../../../components/RequireAuth';
import { ErrorState, LoadingState as Loading } from '../../../components/ui';
import { goBack } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n';
import { useAsync } from '../../../lib/useAsync';
import { errorMessage } from '../../../lib/errors';
import { useAuth } from '../../../lib/auth';
import { sameId } from '../../../lib/format';
import { NotOwner } from '../../../components/NotOwner';

export default function EditCarScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.car(id), [id]);
  return (
    <RequireAuth>
      {loading ? <Loading /> : error || !data ? <ErrorState message={errorMessage(error, t)} onRetry={reload} /> : !sameId(user?.id, data.owner.id) ? <NotOwner fallback={`/car/${id}`} /> : (
        <CarForm
          initial={data}
          title={t('garage.editCar')}
          backLabel={t('common.cancel')}
          onSubmit={async (input) => {
            await api.updateCar(id, input);
            goBack(`/car/${id}`);
          }}
        />
      )}
    </RequireAuth>
  );
}
