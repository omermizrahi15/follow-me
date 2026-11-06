/* eslint-disable @typescript-eslint/unbound-method -- asserting on jest mocks */
import type { IPurchaseService } from '../../domain/interfaces';
import { GetPlusOfferingUseCase, PurchasePlusUseCase, RestorePurchasesUseCase } from './PurchaseUseCases';

function fake(over: Partial<IPurchaseService> = {}): IPurchaseService {
  return {
    available: true,
    getOffering: jest.fn().mockResolvedValue({ packages: [] }),
    purchase: jest.fn().mockResolvedValue('purchased'),
    restore: jest.fn().mockResolvedValue(true),
    hasPlus: jest.fn().mockResolvedValue(false),
    ...over,
  };
}

describe('GetPlusOfferingUseCase', () => {
  it('reports the offering together with whether Plus is already active', async () => {
    const svc = fake({ hasPlus: jest.fn().mockResolvedValue(true) });
    const result = await new GetPlusOfferingUseCase(svc).execute('u1');
    expect(result).toEqual({ available: true, offering: { packages: [] }, active: true });
  });

  it('does not ask the store anything when purchasing is unavailable', async () => {
    const svc = fake({ available: false });
    const result = await new GetPlusOfferingUseCase(svc).execute('u1');
    expect(result).toEqual({ available: false, offering: null, active: false });
    expect(svc.getOffering).not.toHaveBeenCalled();
  });
});

describe('PurchasePlusUseCase', () => {
  it('buys the chosen package for the user', async () => {
    const svc = fake();
    expect(await new PurchasePlusUseCase(svc).execute('u1', 'pkg')).toBe('purchased');
    expect(svc.purchase).toHaveBeenCalledWith('u1', 'pkg');
  });
});

describe('RestorePurchasesUseCase', () => {
  it('returns whether Plus came back', async () => {
    expect(await new RestorePurchasesUseCase(fake()).execute('u1')).toBe(true);
  });
});
