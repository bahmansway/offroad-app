import { ApiError } from '../apiClient';
import { acceptInviteErrorMessage, chatErrorMessage, clanErrorMessage, clanShouldReload, eventErrorMessage, inviteErrorMessage } from '../errors';

const t = (k: string) => k;
const err = (status: number, code: ConstructorParameters<typeof ApiError>[1], message = '') => new ApiError(status, code, message);

describe('chatErrorMessage', () => {
  it('403 means blocked in a DM but "no access" in a clan chat', () => {
    expect(chatErrorMessage(err(403, 'FORBIDDEN'), t, 'dm')).toBe('chat.blockedCannotSend');
    expect(chatErrorMessage(err(403, 'FORBIDDEN'), t, 'clan')).toBe('chat.noAccess');
    expect(chatErrorMessage(err(404, 'NOT_FOUND'), t, 'clan')).toBe('chat.noAccess');
    expect(chatErrorMessage(err(429, 'RATE_LIMITED'), t)).toBe('chat.rateLimited');
  });
});

describe('clanErrorMessage (server sentences from routes/clans.ts)', () => {
  const c = (m: string) => clanErrorMessage(err(409, 'CONFLICT', m), t);
  it('picks the right hint for each 409', () => {
    expect(c('Remove the other members or hand over leadership before deleting the clan')).toBe('clan.deleteHint');
    expect(c('Hand over leadership first, or delete the clan if you are the only member')).toBe('clan.leaderLeaveHint');
    expect(c('A clan with this name already exists')).toBe('clan.nameTaken');
    expect(c('A clan with this tag already exists')).toBe('clan.nameTaken');
    expect(c('You are already in a clan')).toBe('clan.alreadyInClan');
    expect(c('This user is already in a clan')).toBe('clan.alreadyInClan');
    expect(c('Leadership changed meanwhile, try again')).toBe('clan.changed');
    expect(c('You are already the leader')).toBe('clan.changed');
  });
  it('403/404 → changed + reload', () => {
    expect(clanErrorMessage(err(403, 'FORBIDDEN'), t)).toBe('clan.changed');
    expect(clanShouldReload(err(404, 'NOT_FOUND'))).toBe(true);
    expect(clanShouldReload(err(500, 'UNKNOWN'))).toBe(false);
  });
});

describe('v3 invite and event errors', () => {
  it('maps the server invite sentences', () => {
    expect(inviteErrorMessage(err(409, 'CONFLICT', 'This user declined an invite recently; try again in 24 hours'), t)).toBe('clan.inviteDeclinedRecently');
    expect(inviteErrorMessage(err(409, 'CONFLICT', 'This user already has a pending invite'), t)).toBe('clan.inviteAlready');
    expect(inviteErrorMessage(err(409, 'CONFLICT', 'This user is already in a clan'), t)).toBe('clan.inviteInClan');
    expect(inviteErrorMessage(err(409, 'CONFLICT', 'At most 30 pending invites per clan'), t)).toBe('clan.inviteLimit');
    expect(inviteErrorMessage(err(403, 'FORBIDDEN', 'You cannot invite this user'), t)).toBe('clan.inviteBlocked');
    expect(acceptInviteErrorMessage(err(409, 'CONFLICT', 'This invite has expired'), t)).toBe('clan.inviteExpired');
    expect(acceptInviteErrorMessage(err(404, 'NOT_FOUND'), t)).toBe('clan.inviteGone');
  });
  it('maps event join errors', () => {
    expect(eventErrorMessage(err(403, 'FORBIDDEN', 'The organizer removed you from this event'), t, 'join')).toBe('events.errors.removed');
    expect(eventErrorMessage(err(409, 'CONFLICT', 'You can create at most 10 events per day'), t, 'save')).toBe('events.errors.dailyLimit');
    expect(eventErrorMessage(err(404, 'NOT_FOUND'), t)).toBe('events.gone');
  });
});
