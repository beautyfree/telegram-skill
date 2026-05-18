import { describe, expect, it } from 'vitest';
import { isDestructive } from '../src/commands/invoke.js';

describe('isDestructive', () => {
  it('flags message/history deletion variants', () => {
    expect(isDestructive('messages.DeleteHistory')).toBe(true);
    expect(isDestructive('channels.DeleteMessages')).toBe(true);
    expect(isDestructive('messages.DeleteMessages')).toBe(true);
    expect(isDestructive('channels.DeleteChannel')).toBe(true);
  });

  it('flags membership mutations', () => {
    expect(isDestructive('channels.KickFromChannel')).toBe(true);
    expect(isDestructive('channels.EditBanned')).toBe(true);
    expect(isDestructive('channels.EditAdmin')).toBe(true);
    expect(isDestructive('messages.EditChatAdmin')).toBe(true);
    expect(isDestructive('channels.LeaveChannel')).toBe(true);
  });

  it('flags session / auth ops', () => {
    expect(isDestructive('auth.LogOut')).toBe(true);
    expect(isDestructive('account.ResetAuthorization')).toBe(true);
    expect(isDestructive('auth.ResetAuthorizations')).toBe(true);
  });

  it('flags identity edits', () => {
    expect(isDestructive('account.UpdateUsername')).toBe(true);
    expect(isDestructive('account.UpdateProfile')).toBe(true);
  });

  it('lets through plain reads', () => {
    expect(isDestructive('messages.GetHistory')).toBe(false);
    expect(isDestructive('channels.GetFullChannel')).toBe(false);
    expect(isDestructive('users.GetUsers')).toBe(false);
    expect(isDestructive('messages.GetStickers')).toBe(false);
    expect(isDestructive('contacts.GetTopPeers')).toBe(false);
  });
});
