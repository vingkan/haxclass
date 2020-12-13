# HaxClass

Tools for running a class about analytics for HaxBall.

## Server

[Obtain a token](https://www.haxball.com/headlesstoken) for the HaxBall Headless API by completing the reCAPTCHA. Then, choose a room config file and start the server:

```bash
node server.json rooms/test.json YOUR_TOKEN
```

The room config file lets you customize the room.

- `roomName`: Name of HaxBall room
- `maxPlayers`: Maximum number of players allowed
- `playerName`: Nickname for room bot
- `noPlayer`: If `true`, room bot appears in player list
- `public`: If `true`, room will appear in the main list
- `password`: Password for players to join room
- `saveToFirebase`: If `true`, save match data to Firebase
- `saveToLocal`: If `true`, save match data locally
- `showDebugMessages`: If `true`, show debug messages in chat
- `scoreLimit`: Number of goals to win
- `timeLimit`: Number of minutes in regulation
- `teamsLock`: If `true`, only admins can set teams
- `defaultStadium`: Name of default stadium to use
- `customStadium`: Name of custom stadium to use (must be in `stadium` directory)
- `token`: Token for headless API (tokens become invalid after some time)

## Hub

Go to `/hub/replay.html?m=YOUR_MATCH_ID` to view a replay.

## Data

