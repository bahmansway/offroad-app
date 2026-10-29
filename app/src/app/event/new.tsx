import React, { useMemo } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { LoadingState, goBack } from '../../components/ui';
import { RequireAuth } from '../../components/RequireAuth';
import { EventForm } from '../../components/EventForm';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useChat } from '../../lib/chat';
import { useAsync } from '../../lib/useAsync';
import { sameId } from '../../lib/format';
import { successFeedback } from '../../lib/haptics';
import { defaultStart, eventPayload, type EventFormState } from '../../lib/eventLogic';

export default function NewEventScreen() {
  return <RequireAuth><NewEvent /></RequireAuth>;
}

function NewEvent() {
  const { spotId } = useLocalSearchParams<{ spotId?: string }>();
  const { user } = useAuth();
  const chat = useChat();
  const me = useAsync(async () => {
    const [cars, profile, spot] = await Promise.all([
      api.cars(user!.id),
      api.user(user!.id).catch(() => null),
      spotId ? api.spot(spotId).catch(() => null) : Promise.resolve(null),
    ]);
    // the current car first
    const items = [...cars.items].sort((a, b) => (sameId(a.id, user?.currentCarId) ? -1 : sameId(b.id, user?.currentCarId) ? 1 : 0));
    return { cars: items, clan: profile?.clan ?? null, spot };
  }, [user?.id, spotId]);

  const initial = useMemo<EventFormState | null>(() => {
    if (me.loading && !me.data) return null;
    const spot = me.data?.spot ?? null;
    return {
      title: '',
      description: '',
      startsAt: defaultStart(),
      endsAt: null,
      spotId: spot?.id ?? null,
      meetingPoint: null,
      maxCars: '10',
      minDifficulty: spot?.type === 'trail' ? spot.difficulty ?? null : null,
      requirements: [],
      visibility: 'public',
    };
  }, [me.loading, me.data]);

  if (!initial) return <LoadingState />;
  return (
    <EventForm
      mode="create"
      initial={initial}
      initialSpotName={me.data?.spot?.name ?? null}
      myClan={me.data?.clan ?? null}
      cars={me.error ? [] : me.data?.cars ?? null}
      onBack={() => goBack('/events')}
      onSubmit={async (f, car) => {
        const ev = await api.createEvent({ ...eventPayload(f), carId: car!.carId, seats: car!.seats });
        successFeedback();
        chat.reload(); // the new event chat
        router.replace(`/event/${ev.id}`);
      }}
    />
  );
}
