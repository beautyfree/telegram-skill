# Channel / group moderation

The CLI covers read-only inspection (`info`, `chats members`) as first-class commands. Mutating moderation (ban, restrict, promote, demote, kick, invite-link management) goes through `telegram-agent invoke` — the raw MTProto escape hatch.

## Read-only inspection

```bash
telegram-agent info @channel
telegram-agent chats members @channel --limit 200
telegram-agent chats members @channel --query "spam"   # filter by name
```

## Mutating ops — via raw MTProto

`telegram-agent invoke <Namespace.Class> --params '{...}'` accepts any gram.js Api method. Entity-like params (`channel`, `user`, `participant`) auto-hydrate from `@username` / numeric / `me`.

### Ban a user

```bash
telegram-agent invoke channels.EditBanned --params '{
  "channel": "@mychannel",
  "participant": "@baduser",
  "bannedRights": {
    "_": "chatBannedRights",
    "viewMessages": true,
    "untilDate": 0
  }
}'
```

`untilDate: 0` = permanent. Otherwise unix seconds.

### Restrict (mute) a user

```bash
telegram-agent invoke channels.EditBanned --params '{
  "channel": "@mychannel",
  "participant": "@user",
  "bannedRights": {
    "_": "chatBannedRights",
    "sendMessages": true,
    "sendMedia": true,
    "sendStickers": true,
    "sendGifs": true,
    "sendGames": true,
    "sendInline": true,
    "embedLinks": true,
    "untilDate": 0
  }
}'
```

### Promote to admin

```bash
telegram-agent invoke channels.EditAdmin --params '{
  "channel": "@mychannel",
  "userId": "@user",
  "adminRights": {
    "_": "chatAdminRights",
    "changeInfo": true,
    "postMessages": true,
    "editMessages": true,
    "deleteMessages": true,
    "banUsers": true,
    "inviteUsers": true,
    "pinMessages": true,
    "manageCall": false,
    "anonymous": false,
    "other": false
  },
  "rank": "Mod"
}'
```

### Kick (ban + immediate unban)

```bash
telegram-agent invoke channels.EditBanned --params '{
  "channel": "@mychannel",
  "participant": "@user",
  "bannedRights": { "_": "chatBannedRights", "viewMessages": true, "untilDate": 0 }
}'
# then to allow them to rejoin via link:
telegram-agent invoke channels.EditBanned --params '{
  "channel": "@mychannel",
  "participant": "@user",
  "bannedRights": { "_": "chatBannedRights", "untilDate": 0 }
}'
```

## Admin rights — bitmask reference

`chatAdminRights` flags (set to `true` to grant):

- `changeInfo` — edit title/photo/description
- `postMessages` — broadcast channels only
- `editMessages` — edit others' messages
- `deleteMessages` — delete others' messages
- `banUsers` — ban + restrict
- `inviteUsers` — add new members
- `pinMessages`
- `addAdmins` — grant admin to others
- `manageCall` — voice chats
- `anonymous` — post as channel
- `other` — undocumented bucket

## Banned rights — bitmask reference

`chatBannedRights` flags (set to `true` to restrict):

- `viewMessages` — full ban
- `sendMessages`
- `sendMedia` / `sendStickers` / `sendGifs` / `sendGames` / `sendInline`
- `embedLinks`
- `sendPolls`
- `changeInfo` / `inviteUsers` / `pinMessages`
- `manageTopics` — forum groups only

`untilDate`: unix seconds. `0` = permanent.

## Don't

- Don't bulk-ban from a participant list without explicit user approval per user — false-positives leave a permanent record.
- Don't grant `addAdmins` to anyone. That right lets the new admin promote others; it should stay only on the owner.
- Don't `delete_user_history` (wipe all of a user's messages in a chat) without user confirmation. Irreversible and visible to other members.
