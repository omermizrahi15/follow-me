const mockDelete = jest.fn<Promise<void>, []>();
const mockAlert = jest.fn();

jest.mock('../../composition/container', () => ({
  deleteAccount: mockDelete,
  connectivity: { status: 'online' },
}));
jest.mock('react-native', () => ({ Alert: { alert: mockAlert } }));

import { deleteAccountAndSignOut } from './accountDeletion';

beforeEach(() => {
  mockDelete.mockReset();
  mockAlert.mockReset();
});

describe('deleteAccountAndSignOut', () => {
  it('deletes on the server first, then signs out locally', async () => {
    const order: string[] = [];
    mockDelete.mockImplementation(() => { order.push('delete'); return Promise.resolve(); });
    const signOut = jest.fn(() => { order.push('signOut'); return Promise.resolve(); });

    await deleteAccountAndSignOut(signOut);

    expect(order).toEqual(['delete', 'signOut']);
  });

  it('stays signed in when the server could not delete, so the user can retry', async () => {
    mockDelete.mockRejectedValue(new Error('Delete failed (500)'));
    const signOut = jest.fn(() => Promise.resolve());

    await expect(deleteAccountAndSignOut(signOut)).rejects.toThrow('Delete failed');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('still finishes when sign-out errors after the account is already gone', async () => {
    mockDelete.mockResolvedValue();
    const signOut = jest.fn(() => Promise.reject(new Error('session not found')));

    await expect(deleteAccountAndSignOut(signOut)).resolves.toBeUndefined();
  });
});
