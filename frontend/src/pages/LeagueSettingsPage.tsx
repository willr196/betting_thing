import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, EmptyState, Input, Spinner } from '../components/ui';
import { formatDate } from '../lib/utils';
import type { League, LeagueMember, LeagueMembershipSummary } from '../types';

type LeagueDetailResponse = {
  league: League;
  membership: LeagueMembershipSummary;
  memberCount: number;
};

export function LeagueSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { success: showSuccess, error: showError } = useToast();

  const [leagueData, setLeagueData] = useState<LeagueDetailResponse | null>(null);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState('⚽');
  const [isOpen, setIsOpen] = useState(true);
  const [newOwnerId, setNewOwnerId] = useState('');

  const memberOptions = useMemo(
    () => members.filter((member) => member.role !== 'OWNER'),
    [members]
  );

  useEffect(() => {
    if (!id) return;
    void loadSettings(id);
  }, [id]);

  async function loadSettings(leagueId: string) {
    setIsLoading(true);
    try {
      const [detail, memberResult] = await Promise.all([
        api.getLeague(leagueId),
        api.getLeagueMembers(leagueId),
      ]);
      if (detail.membership.role !== 'OWNER') {
        showError('Only league owners can access settings');
        navigate(`/leagues/${leagueId}`);
        return;
      }

      setLeagueData(detail);
      setMembers(memberResult.members);
      setName(detail.league.name);
      setDescription(detail.league.description ?? '');
      setEmoji(detail.league.emoji);
      setIsOpen(detail.league.isOpen);
      setNewOwnerId('');
    } catch (error) {
      if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError('Failed to load league settings');
      }
      navigate('/leagues');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    setIsSaving(true);
    try {
      const result = await api.updateLeague(id, {
        name: name.trim(),
        description: description.trim() || undefined,
        emoji,
        isOpen,
      });
      setLeagueData(result);
      showSuccess('League updated');
    } catch (error) {
      if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError('Failed to update league');
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRegenerateCode() {
    if (!id) return;
    if (!window.confirm('Regenerate invite code? The old code will stop working.')) {
      return;
    }
    setIsRegenerating(true);
    try {
      const invite = await api.regenerateLeagueInviteCode(id);
      if (leagueData) {
        setLeagueData({
          ...leagueData,
          league: {
            ...leagueData.league,
            inviteCode: invite.inviteCode,
          },
        });
      }
      await navigator.clipboard.writeText(invite.inviteUrl);
      showSuccess('New invite code generated and copied');
    } catch (error) {
      if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError('Failed to regenerate code');
      }
    } finally {
      setIsRegenerating(false);
    }
  }

  async function handleTransferOwnership() {
    if (!id || !newOwnerId) return;
    if (!window.confirm('Transfer ownership now? You will become a member.')) {
      return;
    }
    setIsTransferring(true);
    try {
      await api.transferLeagueOwnership(id, newOwnerId);
      showSuccess('Ownership transferred');
      navigate(`/leagues/${id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError('Failed to transfer ownership');
      }
    } finally {
      setIsTransferring(false);
    }
  }

  async function handleDeleteLeague() {
    if (!id) return;
    if (!window.confirm('Delete this league permanently? This cannot be undone.')) {
      return;
    }
    setIsDeleting(true);
    try {
      await api.deleteLeague(id);
      showSuccess('League deleted');
      navigate('/leagues');
    } catch (error) {
      if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError('Failed to delete league');
      }
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!leagueData) {
    return <EmptyState title="League not found" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">League Settings</h1>
          <p className="mt-1 text-gray-600">Manage invite code, members, and ownership</p>
        </div>
        <Link to={`/leagues/${leagueData.league.id}`}>
          <Button variant="secondary">Back to League</Button>
        </Link>
      </div>

      <Card>
        <form className="space-y-4" onSubmit={handleSave}>
          <Input label="League Name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={50} required />
          <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
          <Input label="Emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} required />

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isOpen}
              onChange={(event) => setIsOpen(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            League is open to new members
          </label>

          <div className="flex justify-end">
            <Button type="submit" isLoading={isSaving}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Invite Code</h2>
            <p className="mt-1 text-sm text-gray-600">
              Current code: <span className="font-semibold text-gray-900">{leagueData.league.inviteCode}</span>
            </p>
          </div>
          <Button variant="secondary" onClick={() => void handleRegenerateCode()} isLoading={isRegenerating}>
            Regenerate Code
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-gray-900">Transfer Ownership</h2>
        <p className="mt-1 text-sm text-gray-600">Choose an active member to become the new owner.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <select
            value={newOwnerId}
            onChange={(event) => setNewOwnerId(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Select member...</option>
            {memberOptions.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName} ({member.role})
              </option>
            ))}
          </select>
          <Button
            onClick={() => void handleTransferOwnership()}
            disabled={!newOwnerId}
            isLoading={isTransferring}
          >
            Transfer
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-red-700">Danger Zone</h2>
        <p className="mt-1 text-sm text-gray-600">
          Delete this league permanently, including memberships and standings.
        </p>
        <div className="mt-4 flex justify-end">
          <Button variant="danger" onClick={() => void handleDeleteLeague()} isLoading={isDeleting}>
            Delete League
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Members</h2>
        <div className="space-y-2">
          {members.map((member) => (
            <div key={member.userId} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
              <div>
                <p className="font-medium text-gray-900">{member.displayName}</p>
                <p className="text-xs text-gray-500">Joined {formatDate(member.joinedAt)}</p>
              </div>
              <Badge className={member.role === 'OWNER' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}>
                {member.role}
              </Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

