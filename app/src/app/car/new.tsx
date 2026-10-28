import React from 'react';
import { router } from 'expo-router';
import { CarForm } from '../../components/CarForm';
import { RequireAuth } from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

export default function NewCarScreen() {
  const { t } = useI18n();
  return (
    <RequireAuth>
      <CarForm
        title={t('garage.addCar')}
        onSubmit={async (input) => {
          const car = await api.createCar(input);
          router.replace(`/car/${car.id}`);
        }}
      />
    </RequireAuth>
  );
}
