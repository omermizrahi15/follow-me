import type { ContactsPermission, DeviceContact, IContactsDirectory } from '../../domain/interfaces';
import { ResolveContactNamesUseCase } from './ResolveContactNamesUseCase';

class FakeContactsDirectory implements IContactsDirectory {
  listCalls = 0;

  constructor(
    private readonly contacts: DeviceContact[],
    private permissionState: ContactsPermission = 'granted',
    private readonly available = true,
  ) {}

  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.available);
  }

  permission(): Promise<ContactsPermission> {
    return Promise.resolve(this.permissionState);
  }

  requestPermission(): Promise<ContactsPermission> {
    this.permissionState = this.permissionState === 'undetermined' ? 'granted' : this.permissionState;
    return Promise.resolve(this.permissionState);
  }

  list(): Promise<DeviceContact[]> {
    this.listCalls += 1;
    return Promise.resolve(this.contacts);
  }
}

const DANA: DeviceContact = {
  id: '1',
  name: 'Dana',
  imageUri: null,
  phoneNumbers: ['050-123 4567'],
};

const PUBLISHER_PHONE = '+972541112222';

describe('ResolveContactNamesUseCase', () => {
  it('names the followers it can match', async () => {
    const useCase = new ResolveContactNamesUseCase(new FakeContactsDirectory([DANA]));

    const names = await useCase.resolve(['+972501234567', '+972539999999'], PUBLISHER_PHONE);

    expect(names.get('+972501234567')?.name).toBe('Dana');
    expect(names.has('+972539999999')).toBe(false);
  });

  it('returns no names without permission, and never reads the address book', async () => {
    const directory = new FakeContactsDirectory([DANA], 'denied');
    const useCase = new ResolveContactNamesUseCase(directory);

    expect((await useCase.resolve(['+972501234567'], PUBLISHER_PHONE)).size).toBe(0);
    expect(directory.listCalls).toBe(0);
  });

  it('returns no names when there is no address book at all', async () => {
    const useCase = new ResolveContactNamesUseCase(
      new FakeContactsDirectory([DANA], 'granted', false),
    );

    expect((await useCase.resolve(['+972501234567'], PUBLISHER_PHONE)).size).toBe(0);
  });

  it('falls back to no names when reading contacts throws', async () => {
    const directory = new FakeContactsDirectory([DANA]);
    jest.spyOn(directory, 'list').mockRejectedValue(new Error('address book unavailable'));
    const useCase = new ResolveContactNamesUseCase(directory);

    await expect(useCase.resolve(['+972501234567'], PUBLISHER_PHONE)).resolves.toEqual(new Map());
  });

  it('does not touch the address book when there are no followers', async () => {
    const directory = new FakeContactsDirectory([DANA]);

    expect((await new ResolveContactNamesUseCase(directory).resolve([], PUBLISHER_PHONE)).size).toBe(0);
    expect(directory.listCalls).toBe(0);
  });

  it('reports access without prompting, and unavailable when there is no address book', async () => {
    await expect(
      new ResolveContactNamesUseCase(new FakeContactsDirectory([], 'undetermined')).access(),
    ).resolves.toBe('undetermined');
    await expect(
      new ResolveContactNamesUseCase(new FakeContactsDirectory([], 'granted', false)).access(),
    ).resolves.toBe('unavailable');
  });

  it('prompts on requestAccess', async () => {
    const useCase = new ResolveContactNamesUseCase(new FakeContactsDirectory([], 'undetermined'));

    await expect(useCase.requestAccess()).resolves.toBe('granted');
  });

  it('reports unavailable rather than throwing when the permission check fails', async () => {
    const directory = new FakeContactsDirectory([]);
    jest.spyOn(directory, 'permission').mockRejectedValue(new Error('boom'));

    await expect(new ResolveContactNamesUseCase(directory).access()).resolves.toBe('unavailable');
  });
});
