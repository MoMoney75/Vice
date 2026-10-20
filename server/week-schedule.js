function eventIsCompleted(event) {
  const status = event.competitions?.[0]?.status ?? event.status;
  return Boolean(status?.type?.completed);
}

export function selectScheduleWeek(currentWeek, currentEvents, nextEvents = []) {
  const currentWeekIsComplete =
    currentEvents.length > 0 && currentEvents.every(eventIsCompleted);

  if (currentWeekIsComplete && nextEvents.length > 0) {
    return { week: currentWeek + 1, events: nextEvents };
  }
  return { week: currentWeek, events: currentEvents };
}
