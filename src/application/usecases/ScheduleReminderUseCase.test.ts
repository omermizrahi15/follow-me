import { ScheduleReminderUseCase } from './ScheduleReminderUseCase';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import { FakeNotificationScheduler } from '../../test-support/fakes';

function config(notifyDayOfWeek: number, notifyTime: string): PublisherConfig {
  return PublisherConfig.create({
    publisherId: 'pub-1',
    frequency: 'weekly',
    photosPerPost: 5,
    requireApproval: true,
    notifyDayOfWeek,
    notifyTime,
  });
}

describe('ScheduleReminderUseCase', () => {
  it('schedules a weekly reminder from the config day and time', async () => {
    const scheduler = new FakeNotificationScheduler();
    const useCase = new ScheduleReminderUseCase(scheduler);

    await useCase.execute(config(3, '07:45'));

    expect(scheduler.scheduled).toEqual({ dayOfWeek: 3, hour: 7, minute: 45 });
  });

  it('uses default schedule when config omits it', async () => {
    const scheduler = new FakeNotificationScheduler();
    const useCase = new ScheduleReminderUseCase(scheduler);

    await useCase.execute(
      PublisherConfig.create({
        publisherId: 'pub-1',
        frequency: 'weekly',
        photosPerPost: 5,
        requireApproval: true,
      }),
    );

    expect(scheduler.scheduled).toEqual({ dayOfWeek: 0, hour: 18, minute: 0 });
  });
});
