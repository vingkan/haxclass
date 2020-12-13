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

## Data Schema

There are seven kinds of records stored for each match:

- `score`: Single record, describes the final score.
- `stadium`: Single record, describes the stadium.
- `players`: Many records, lists the players.
- `goals`: Many records, lists the goals scored.
- `kicks`: Many records, lists times players kicked the ball.
- `possessions`: Many records, lists periods players possessed the ball.
- `positions`: Many records, lists the positions of players at each time step.

You can download data for a match as JSON or CSV.

### JSON Format

In JSON format, the top-level object has seven keys, one for each record type. For `score`, the value is a single object and for `stadium`, the value is a string. For the other five keys, the value is a list of objects.

```json
{
  "score": {
    "red": 3,
    "blue": 1,
    "time": 58.2,
    "scoreLimit": 3,
    "timeLimit": 180
  },
  "stadium": "NAFL Official Map v1",
  "players": [ ... ],
  "goals": [ ... ],
  "kicks": [ ... ],
  "possessions": [ ... ],
  "positions": [ ... ]
}
```

### CSV Format

In CSV format, the first value of each row denotes what type of record it is. You can filter by this column to view only that type of record. The first seven lines of the CSV give the headers for each type.

```csv
score,red,blue,time,scoreLimit,timeLimit
stadium,name
players,id,name,team
goals,time,team,scoreRed,scoreBlue,ballX,ballY,scorerId,scorerX,scorerY,scorerName,scorerTeam,assistId,assistX,assistY,assistName,assistTeam
kicks,time,type,fromId,fromX,fromY,fromName,fromTeam,toId,toX,toY,toName,toTeam
possessions,start,end,playerId,playerName,team
positions,type,time,x,y,playerId,name,team
```

### Score

- `red`: Number of goals scored for the red team.
- `blue`: Number of goals scored for the blue team.
- `time`: Duration of the match, in seconds, including overtime.
- `scoreLimit`: Number of goals needed to win by goals.
- `timeLimit`: Time limit in seconds for regulation.

### Stadium

The match data contains only the stadium name, which you can use to look up additional data about the stadium in `stadium/map_data.json`.

### Players

- `id`: Numerical ID for player, unique for the match, but may not be the same across matches.
- `name`: Player screen name.
- `team`: Player team at the end of the match, either `red` or `blue`.

### Goals

The last player to touch the ball before it goes into the goal is credited with scoring.

If the scorer scored against their own team, there will be no assist. Otherwise, if the scorer received the ball on a pass from a teammate, that teammate is credited with the assist.

For the `assist` fields, if there is no player credited with the assist, the values will be `null` in JSON format and blank in CSV format.

- `time`: Match time when goal was scored, in seconds.
- `team`: Team goal was scored for, either `red` or `blue`.
- `scoreRed`: New score for red team.
- `scoreBlue`: New score for blue team.
- `ballX`: X-coordinate of ball after goal.
- `ballY`: Y-coordinate of ball after goal.
- `scorerId`: Numerical ID of player credited with scoring.
- `scorerX`: X-coordinate of player credited with scoring.
- `scorerY`: Y-coordinate of player credited with scoring.
- `scorerName`: Screen name of player credited with scoring.
- `scorerTeam`: Team of player credited with scoring.
- `assistId`: Numerical ID of player credited with assist.
- `assistX`: X-coordinate of player credited with assist.
- `assistY`: Y-coordinate of player credited with assist.
- `assistName`: Screen name of player credited with assist.
- `assistTeam`: Team of player credited with assist.

### Kicks

Kicks involve a player who kicked the ball (`from`) and a player who received the ball (`to`), if any.

There are six types of kicks. Depending on the type of kick, `from` and `to` indicate different players.

- Pass (`pass`): When a player (`from`) kicks the ball to a teammate (`to`).
- Steal (`steal`): When a player (`from`) kicks the ball to an opponent (`to`).
- Goal (`goal`): When a player (`from`) scores for their team (no `to`).
- OwnGoal (`own_goal`): When a player (`from`) scores against their team (no `to`).
- Save (`save`): When a player (`from`) kicks the ball to an opponent (`to`), who receives it in the goal area.
- Error (`error`): When a player (`from`) kicks the ball and it deflects off of an opponent (`to`), resulting in an own goal.

For the `to` fields, if there is no receiving player for the kick, the values will be `null` in JSON format and blank in CSV format.

- `time`: Match time when the kick finished, in seconds.
- `type`: Type of kick, must be one of the six types listed above.
- `fromId`: Numerical ID of player who kicked the ball.
- `fromX`: X-coordinate of player who kicked the ball.
- `fromY`: Y-coordinate of player who kicked the ball.
- `fromName`: Screen name of player who kicked the ball.
- `fromTeam`: Team of player who kicked the ball.
- `toId`: Numerical ID of player who received the ball.
- `toX`: X-coordinate of player who received the ball.
- `toY`: Y-coordinate of player who received the ball.
- `toName`: Screen name of player who received the ball.
- `toTeam`: Team of player who received the ball.

### Possessions

Each possession record describes a time period when a specific player had sole control of the ball.

- `start`: Match time when the possession started, in seconds.
- `end`: Match time when the possession ended, in seconds.
- `playerId`: Numerical ID of player who possessed the ball.
- `playerName`: Screen name of player who possessed the ball.
- `team`: Team of player who possessed the ball.

### Positions

Each position record describes the location of a player or the ball at a point during the match.

If the record type is `ball`, the values for `playerID`, `name`, and `team` will be `null` in JSON format and blank in CSV format.

- `type`: Type of position, either `ball` or `player`.
- `time`: Match time when the position was recorded, in seconds.
- `x`: X-coordinate of the ball or player.
- `y`: Y-coordinate of the ball or player.
- `playerId`: Numerical ID of the player.
- `name`: Screen name of the player.
- `team`: Team of the player.
