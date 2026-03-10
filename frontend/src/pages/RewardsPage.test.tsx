import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RewardsPage } from './RewardsPage';

const {
  getPointsBalanceMock,
  getRewardsMock,
  getMyRedemptionsMock,
  redeemRewardMock,
  refreshUserMock,
  toastSuccessMock,
  toastErrorMock,
  authState,
} = vi.hoisted(() => ({
  getPointsBalanceMock: vi.fn(),
  getRewardsMock: vi.fn(),
  getMyRedemptionsMock: vi.fn(),
  redeemRewardMock: vi.fn(),
  refreshUserMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  authState: {
    user: { pointsBalance: 0 } as { pointsBalance: number } | null,
  },
}));

vi.mock('../lib/api', () => {
  class MockApiError extends Error {
    constructor(
      message: string,
      public code: string,
      public status: number
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  return {
    api: {
      getPointsBalance: getPointsBalanceMock,
      getRewards: getRewardsMock,
      getMyRedemptions: getMyRedemptionsMock,
      redeemReward: redeemRewardMock,
    },
    ApiError: MockApiError,
  };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
    refreshUser: refreshUserMock,
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
  }),
}));

describe('RewardsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { pointsBalance: 0 };

    getPointsBalanceMock.mockResolvedValue({
      balance: 120,
      verified: true,
    });
    getRewardsMock.mockResolvedValue({
      rewards: [
        {
          id: 'reward_1',
          name: 'Gift Card',
          description: 'Redeemable reward',
          pointsCost: 100,
          stockLimit: null,
          stockClaimed: 0,
          isActive: true,
          imageUrl: null,
          createdAt: '2026-03-10T00:00:00.000Z',
        },
      ],
    });
    getMyRedemptionsMock.mockResolvedValue({ redemptions: [] });
    redeemRewardMock.mockResolvedValue({
      redemption: {
        id: 'redemption_1',
      },
      achievementsUnlocked: [],
    });
    refreshUserMock.mockResolvedValue(undefined);
  });

  it('uses the live points balance so newly won points can be redeemed immediately', async () => {
    render(<RewardsPage />);

    expect(await screen.findByText('120 points')).toBeInTheDocument();
    expect(refreshUserMock).toHaveBeenCalled();

    const redeemButton = screen.getByRole('button', { name: 'Redeem' });
    expect(redeemButton).toBeEnabled();

    await userEvent.setup().click(redeemButton);

    await waitFor(() => {
      expect(redeemRewardMock).toHaveBeenCalledWith('reward_1');
    });

    expect(toastErrorMock).not.toHaveBeenCalledWith('Insufficient points balance');
  });
});
