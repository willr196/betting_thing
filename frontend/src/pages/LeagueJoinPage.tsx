import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Button, Card, Input } from '../components/ui';

function getCodeFromSearch(search: string): string {
  return new URLSearchParams(search).get('code')?.toUpperCase().trim() ?? '';
}

export function LeagueJoinPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { success: showSuccess, error: showError } = useToast();

  const [inviteCode, setInviteCode] = useState(getCodeFromSearch(location.search));
  const [isJoining, setIsJoining] = useState(false);
  const [autoJoinAttempted, setAutoJoinAttempted] = useState(false);

  useEffect(() => {
    const code = getCodeFromSearch(location.search);
    setInviteCode(code);
    setAutoJoinAttempted(false);
  }, [location.search]);

  useEffect(() => {
    if (!inviteCode || autoJoinAttempted) {
      return;
    }
    setAutoJoinAttempted(true);
    void joinLeague(inviteCode);
  }, [inviteCode, autoJoinAttempted]);

  async function joinLeague(code: string) {
    setIsJoining(true);
    try {
      const result = await api.joinLeague(code);
      showSuccess('Joined league');
      navigate(`/leagues/${result.league.id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError('Failed to join league');
      }
    } finally {
      setIsJoining(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await joinLeague(inviteCode.toUpperCase().trim());
  }

  return (
    <div className="mx-auto max-w-lg py-8">
      <Card>
        <h1 className="text-2xl font-bold text-gray-900">Join League</h1>
        <p className="mt-1 text-sm text-gray-600">Enter an invite code to join a private league.</p>
        <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <Input
            label="Invite Code"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value.toUpperCase().trim())}
            minLength={8}
            maxLength={8}
            placeholder="ABCD1234"
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => navigate('/leagues')}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isJoining}>
              Join League
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

