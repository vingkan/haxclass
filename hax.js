/* global HBInit */

const CONFIG = JSON.parse(window.RAW_CONFIG);
const DEBUG_MODE = CONFIG.showDebugMessages;

const NOTICE = "This server is collecting your nickname and gameplay data. We do not collect your chat logs.";

const TEAMS = { 1: "Red", 2: "Blue", Red: 1, Blue: 2 };

const KICK_TYPE = {
    Pass: "pass",
    Steal: "steal",
    Save: "save",
    Goal: "goal",
    Error: "error",
    OwnGoal: "own_goal",
};

const EVENT_TYPE = {
    Start: "start",
    Stop: "stop",
    Victory: "victory",
    SaveToError: "save_to_error",
};

const POSITION_TYPE = {
    Player: "player",
    Ball: "ball",
};

const TOUCH_SOURCE = {
    Kick: "kick",
    Touch: "touch",
};

// These two values can change based on the stadium.
let BALL_RADIUS;;
let TOUCH_THRESHOLD;
// COnstants for data measurements.
const TOUCH_RADIUS = 0.01;
const PLAYER_RADIUS = 15;
const POSITION_PRECISION = 0;
const TIME_PRECISION = 1;
const POSITION_SAVE_COOLDOWN = 0.25;
const SMALL_TIME_STEP = 0.01;
const GOALPOST_ZERO = 0.1;
const GOAL_AREA_RADIUS = 1.5;

// Client keys that allow read-only access.
const firebaseConfig = {
    apiKey: "AIzaSyA4kjMsnaUhaGYL8tCS4FTj2UtGNWYKV14",
    authDomain: "haxclass.firebaseapp.com",
    databaseURL: "https://haxclass.firebaseio.com",
    projectId: "haxclass",
    storageBucket: "haxclass.appspot.com",
    messagingSenderId: "425802086346",
    appId: "1:425802086346:web:595b8d5f7058079a3e0133"
};

function parseColors(colorStr) {
    const c = colorStr.split(" ");
    return [
        c[1] === "red" ? TEAMS.Red : TEAMS.Blue,
        parseInt(c[2], 10),
        parseInt(c[3], 16),
        c.slice(4).map(h => parseInt(h, 16)),
    ];
}

async function initRoom(room, config) {
    // Set defaults.
    if (config.defaultStadium) {
        room.setDefaultStadium(config.defaultStadium);
    }
    if (config.hasOwnProperty("scoreLimit")) {
        room.setScoreLimit(config.scoreLimit);
    }
    if (config.hasOwnProperty("timeLimit")) {
        room.setTimeLimit(config.timeLimit);
    }
    room.setTeamsLock(config.teamsLock);
    // Set team colors.
    if (config.colorsRed) {
        room.setTeamColors(...parseColors(config.colorsRed));
    }
    if (config.colorsBlue) {
        room.setTeamColors(...parseColors(config.colorsBlue));
    }
    // Set custom stadium.
    if (config.customStadium) {
        const rawStadium = await window.loadStadium(config.customStadium);
        if (rawStadium) {
            room.setCustomStadium(rawStadium);
        } else {
            room.sendAnnouncement(`Failed to load stadium: ${config.customStadium}`);
        }        
    }
    console.log(`Room: ${config.roomName}`);
    if (config.password) {
        console.log(`Pass: ${config.password}`);    
    } else {
        console.log("Open Room");
    }
    if (config.streamLive) {
        console.log(`Livestream Name: ${config.streamName}`);
    }
    return room;
}

function maybePromoteAdmin(room) {
    const players = room.getPlayerList();
    // If there are no players, there is no one to be admin.
    if (players.length === 0) {
        return false;
    }
    let nextAdminId = null;
    for (let i = 0; i < players.length; i++) {
        // Skip the host admin, assuming they are first on the players list.
        // if (i === 0) {
        //     continue;
        // }
        // If we already have a player admin, we do not need another.
        if (players[i].admin === true) {
            return true;
        } else if (nextAdminId === null) {
            nextAdminId = players[i].id;
        }
    }
    // Otherwise, select the first non-admin player to promote.
    room.setPlayerAdmin(nextAdminId, true);
    return true;
}

function getBallRadius(room) {
    const nDiscs = room.getDiscCount();
    for (let i = 0; i < nDiscs; i++) {
        const disc = room.getDiscProperties(i);
        const isBall = (disc.cGroup & room.CollisionFlags.ball) != 0;
        if (isBall) {
            return disc.radius;
        }
    }
    return false;
}

function getGoalposts(room) {
    let posts = [];
    let gpMinX = Infinity;
    const nDiscs = room.getDiscCount();
    for (let i = 0; i < nDiscs; i++) {
        const disc = room.getDiscProperties(i);
        const isRedKO = (disc.cGroup & room.CollisionFlags.redKO) != 0;
        const isBlueKO = (disc.cGroup & room.CollisionFlags.blueKO) != 0;
        if (isRedKO || isBlueKO) {
            posts.push(disc);
            gpMinX = Math.min(disc.x, gpMinX);
        }
    }
    let gpRed = {
        posts: [],
        size: 0,
        mid: { x: 0, y: 0 },
    };
    let gpBlue = {
        posts: [],
        size: 0,
        mid: { x: 0, y: 0 },
    };
    posts.forEach((gp) => {
        // If the x-coord of the goalpost is at min (left side), it is red.
        if (Math.abs(gp.x - gpMinX) < GOALPOST_ZERO) {
            gpRed.posts.push({ x: gp.x, y: gp.y });
            gpRed.mid.x = gp.x;
        } else {
            gpBlue.posts.push({ x: gp.x, y: gp.y });
            gpBlue.mid.x = gp.x;
        }
    });
    // The primary goal dimension is the difference in y-coords of the posts.
    gpRed.size = Math.abs(gpRed.posts[1].y - gpRed.posts[0].y);
    gpBlue.size = Math.abs(gpBlue.posts[1].y - gpBlue.posts[0].y);
    // Set the y-coords for the midpoints between the goalposts.
    gpRed.mid.y = Math.min(gpRed.posts[0].y, gpRed.posts[1].y) + (gpRed.size / 2);
    gpBlue.mid.y = Math.min(gpBlue.posts[0].y, gpBlue.posts[1].y) + (gpBlue.size / 2);
    return { [TEAMS.Red]: gpRed, [TEAMS.Blue]: gpBlue };
}

/*
 * Check whether the given position is within the area the goal.
 * Uses the goal radius implementation.
 * gp: stadium goalpost to check, with size and midpoints
 * pos: object with x and y-coords to check
 */
function inGoalArea(gp, pos) {
    if (!pos || !gp) {
        return null;
    }
    const radius = GOAL_AREA_RADIUS * gp.size / 2;
    const mid = gp.mid;
    const d = Math.sqrt(
        Math.pow(pos.x - mid.x, 2) + Math.pow(pos.y - mid.y, 2)
    );
    return d < radius;
}

function roundTo(n, p) {
    if (p > 0) {
        return parseFloat(n.toFixed(p), 10);
    } else {
        return parseInt(n.toFixed(0), 10);
    }
}

function roundTime(time) {
    return roundTo(time, TIME_PRECISION);
}

function roundCoord(coord) {
    return roundTo(coord, POSITION_PRECISION);
}

function roundScore(score) {
    return {
        ...score,
        time: roundTime(score.time),
    };
}

function flattenPlayer(player) {
    if (!player) {
        return null;
    }
    return {
        id: player.id,
        name: player.name,
        team: player.team,
        x: player.position ? roundCoord(player.position.x) : null,
        y: player.position ? roundCoord(player.position.y) : null,
    };
}

function saveDrive(drive) {
    return [
        roundTime(drive.start),
        roundTime(drive.end),
        drive.player,
        drive.team,
    ].join(",");
}

function savePosition(pos) {
    if (pos.type === POSITION_TYPE.Player) {
        return [
            roundTime(pos.time),
            roundCoord(pos.x),
            roundCoord(pos.y),
            pos.id,
        ].join(",");
    } else {
        return [
            roundTime(pos.time),
            roundCoord(pos.x),
            roundCoord(pos.y),
        ].join(",");
    }
}

function saveGoal(goal) {
    const goalData = [
        roundTime(goal.time),
        goal.team,
        goal.scoreRed,
        goal.scoreBlue,
        roundCoord(goal.ball.x),
        roundCoord(goal.ball.y),
        goal.scorer.id,
        goal.scorer.x,
        goal.scorer.y,
    ];
    if (goal.assist) {
        const assistData = [
            goal.assist.id,
            goal.assist.x,
            goal.assist.y,
        ];
        return goalData.concat(assistData).join(",");
    } else {
        return goalData.join(",");
    } 
}

function saveKick(kick) {
    const fromData = [
        roundTime(kick.time),
        kick.type,
        kick.from.id,
        kick.from.x,
        kick.from.y,
    ];
    if (kick.to) {
        const toData = [
            kick.to.id,
            kick.to.x,
            kick.to.y,
        ];
        return fromData.concat(toData).join(",");
    } else {
        return fromData.join(",");
    }
}

function saveAllTimeKick(kick, stadium) {
    let kickData = {
        stadium,
        time: roundTime(kick.time),
        type: kick.type,
        fromName: kick.from.name,
        fromX: kick.from.x,
        fromY: kick.from.y,
        fromTeam: kick.from.team === TEAMS.Red ? "red" : "blue",
        scoreRed: kick.score.red,
        scoreBlue: kick.score.blue,
        scoreLimit: kick.score.scoreLimit,
        timeLimit: kick.score.timeLimit,
    };
    if (kick.to) {
        kickData = {
            ...kickData,
            toName: kick.to.name,
            toX: kick.to.x,
            toY: kick.to.y,
            toTeam: kick.to.team === TEAMS.Red ? "red" : "blue",
        };
    }
    if (kick.assist) {
        kickData = {
            ...kickData,
            assistName: kick.assist.name,
            assistX: kick.assist.x,
            assistY: kick.assist.y,
            assistTeam: kick.assist.team === TEAMS.Red ? "red" : "blue",
        };
    }
    return kickData;
}

function leftpad(val) {
    if (val < 10) {
        return `0${val}`;
    } else {
        return `${val}`;
    }
}

function plural(n, singular, plural) {
    return `${n} ${n === 1 ? singular : plural}`;
}

/*
 * Return the game time in seconds (float), does not count time paused.
 */
function getTime(room) {
    return room.getScores().time;
}

/*
 * Convert seconds to clock format (m:ss).
 */
function toClock(secs) {
    const s = Math.floor(secs);
    return `${Math.floor(s / 60)}:${leftpad(s % 60)}`;
}

/*
 * Return the game time in seconds (float), does not count time paused.
 */
function getTime(room) {
    return room.getScores().time;
}

/*
 * Get the player who assisted the goal, or null if none.
 * last: player who kicked the ball last, or null if none
 * prev: player who kicked the ball before last, or null if none
 * team: ID of team that scored
 */
function getAssister(last, prev, team) {
    if (last === null || prev === null) {
        return null;
    }
    // Own goals don't have assists.
    if (last.team !== team) {
        return null;
    }
    // No assister if the scorer kicked it twice in a row.
    if (last.id === prev.id) {
        return null;
    }
    // Assister must be on same team.
    if (last.team === prev.team) {
        return prev;
    }
}

/* Livestream Methods */

function startStream(room, db) {
    return new Promise((resolve, reject) => {
        if (!CONFIG.streamLive) {
            resolve(null);
        } else {
            db.ref(`live/${CONFIG.streamName}`).push(true).then((snap) => {
                const streamId = snap.key;
                console.log(`Streaming to: live/${CONFIG.streamName}/${streamId}`);
                room.sendAnnouncement("Started livestream.");
                resolve(streamId);
            }).catch((err) => {
                console.log("Error starting stream:");
                console.log(err);
                room.sendAnnouncement("Error starting stream, check logs.");
                resolve(null);
            });
        }
    });
}

function streamData(db, streamId, data) {
    // console.log(`streamData(${db ? true : false}, ${streamId}, ${JSON.stringify(data, null, 2)})`);
    return new Promise((resolve, reject) => {
        if (!CONFIG.streamLive) {
            resolve();
        } else {
            try {
                db.ref(`live/${CONFIG.streamName}/${streamId}`).push(data).then(() => {
                    resolve();
                }).catch((err) => {
                    console.log(`Firebase error pushing to stream: live/${CONFIG.streamName}/${streamId}`);
                    console.log(err);
                    resolve();
                });
            } catch (err) {
                console.log(`JS error pushing to stream: live/${CONFIG.streamName}/${streamId}`);
                console.log(err);
                resolve();
            }
        }
    });
}

/* Room Initialization */

// Initialize database connection if requested.
let db;
if (CONFIG.streamLive && firebase) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    console.log("Initialized DB connection.");
} else {
    console.log("Did not initialize DB connection.");
}

// Initialize HaxBall Headless API.
const room = HBInit(CONFIG);
initRoom(room, CONFIG);

room.sendDebug = function(text) {
    if (DEBUG_MODE) {
        this.sendAnnouncement(text);   
    }
}

window.onerror = function(err) {
    console.log("Window Error:");
    console.log(err);
    console.log(err.toString());
}

let goals;
let kicks;
let positions;
let possessions;
let goalposts;

let prevKickPlayer;
let lastKickPlayer;

let lastTouchPlayer;
let lastTouchSource;
let possessionStartTime;
let lastClockTime;

let lastPositionSaveTime;

let matchPlayersMap = null;;

let currentStadiumName;

let currentStreamId;

room.onGameStart = async function(byPlayer) {
    // console.log("Game started.");
    const score = room.getScores();
    currentStreamId = await startStream(room, db);
    streamData(db, currentStreamId, {
        type: EVENT_TYPE.Start,
        timeLimit: score.timeLimit,
        scoreLimit: score.scoreLimit,
        stadium: currentStadiumName,
    });
    goals = [];
    kicks = [];
    positions = [];
    possessions = [];
    
    try {
        goalposts = getGoalposts(room);
    } catch (err) {
        goalposts = { [TEAMS.Red]: null, [TEAMS.Blue]: null };
        console.log(`Failed to find goalposts for stadium: ${currentStadiumName}`);
        console.log(err.toString());
    }
    try {
        BALL_RADIUS = getBallRadius(room);
        TOUCH_THRESHOLD = BALL_RADIUS + PLAYER_RADIUS + TOUCH_RADIUS;
    } catch (err) {
        BALL_RADIUS = 5.8;
        TOUCH_THRESHOLD = BALL_RADIUS + PLAYER_RADIUS + TOUCH_RADIUS;
        console.log(`Failed to find ball radius for stadium: ${currentStadiumName}`);
        console.log(err.toString());
    }
    room.sendDebug(`Changed ball radius to ${BALL_RADIUS} for stadium: ${currentStadiumName}`);

    prevKickPlayer = null;
    lastKickPlayer = null;

    lastTouchPlayer = null;
    lastTouchSource = null;
    possessionStartTime = 0;
    lastClockTime = 0;

    // Start negative on first run to ensure initial positions are saved.
    lastPositionSaveTime = -1.05 * POSITION_SAVE_COOLDOWN;

    // Save all players that were part of the match.
    matchPlayersMap = {};
}

room.onTeamVictory = async function(score) {
    // console.log("Game won.");
    // Record and update team possession
    const time = getTime(room);
    const drive = {
        start: possessionStartTime,
        end: time,
        player: lastTouchPlayer ? lastTouchPlayer.id : null,
        team: lastTouchPlayer ? lastTouchPlayer.team : null,
    };
    // If the game ends on a goal, the drive was saved in the goal handler,
    // but if the game ends on time, we need to save it here. If the drive
    // has the same start and end time, we can drop it.
    if (drive.end - drive.start > SMALL_TIME_STEP) {
        possessions.push(drive);
    }
    // Save game record.
    const finalPlayers = Object.keys(matchPlayersMap).map((k) => {
        const p = matchPlayersMap[k];
        const { id, name, team } = p;
        return { id, name, team };
    });
    const finalPlayersRed = finalPlayers.filter((p) => p.team === TEAMS.Red);
    const finalPlayersBlue = finalPlayers.filter((p) => p.team === TEAMS.Blue);
    const finalScore = roundScore(score);
    const summary = {
        scoreRed: finalScore.red,
        scoreBlue: finalScore.blue,
        time: finalScore.time,
        timeLimit: finalScore.timeLimit,
        scoreLimit: finalScore.scoreLimit,
        stadium: currentStadiumName,
        playersRed: finalPlayersRed.map(p => p.name).join(", "),
        playersBlue: finalPlayersBlue.map(p => p.name).join(", "),
    };
    const record = {
        score: finalScore,
        stadium: currentStadiumName,
        players: finalPlayers,
        goals: goals.map(saveGoal),
        kicks: kicks.map(saveKick),
        possessions: possessions.map(saveDrive),
        positions: positions.map(savePosition),
    };
    const allTimeKicks = kicks.map((k) => saveAllTimeKick(k, currentStadiumName));
    const message = await window.saveGameRecord(record, summary, allTimeKicks);
    room.sendAnnouncement(message);
    if (CONFIG.postGameMessages) {
        CONFIG.postGameMessages.forEach((msg) => {
            room.sendAnnouncement(msg);
        });
    }
    await streamData(db, currentStreamId, {
        type: EVENT_TYPE.Victory,
        scoreRed: finalScore.red,
        scoreBlue: finalScore.blue,
        time: score.time,
        timeLimit: score.timeLimit,
        scoreLimit: score.scoreLimit,
        message,
    });
    // const expRecord = {
    //     score: finalScore,
    //     stadium: currentStadiumName,
    //     players: finalPlayers,
    //     goals: goals.map(saveGoal),
    //     kicks: kicks.map(saveKick),
    //     possessions: possessions.map(saveDrive),
    //     positions: positions.map(savePosition),
    // };
    // const expRecordMsg = await window.saveGameRecord(expRecord, summary);
    // room.sendAnnouncement(`Experimental Record: ${expRecordMsg}`);
}

room.onGameStop = async function(byPlayer) {
    // console.log("Game stopped.");
    await streamData(db, currentStreamId, {
        type: EVENT_TYPE.Stop,
        byPlayer,
    });
    matchPlayersMap = null;
}

room.onStadiumChange = function(stadiumName, byPlayer) {
    currentStadiumName = stadiumName;
}

room.onPlayerJoin = function(player) {
    maybePromoteAdmin(room);
    room.sendAnnouncement(`Welcome, ${player.name}.`);
    if (CONFIG.saveToFirebase || CONFIG.saveToLocal) {
        room.sendAnnouncement(NOTICE, targetId=player.id);
    }
    if (CONFIG.welcomeMessages) {
        CONFIG.welcomeMessages.forEach((msg) => {
            room.sendAnnouncement(msg);
        });
    }
}

room.onPlayerLeave = function(player) {
    maybePromoteAdmin(room);
}

function updateTouched(newTouchPlayer, fromKick) {
    const time = getTime(room);
    const score = room.getScores();
    if (!lastTouchPlayer) {
        lastTouchPlayer = newTouchPlayer;
        lastTouchSource = TOUCH_SOURCE.Kick;
        possessionStartTime = time;
    } else if (newTouchPlayer) {
        if (lastTouchPlayer.id !== newTouchPlayer.id) {
            // Save possession
            const drive = {
                start: possessionStartTime,
                end: time,
                player: lastTouchPlayer.id,
                team: lastTouchPlayer.team,
            };
            possessions.push(drive);
            possessionStartTime = time;
            // Save kick
            if (lastTouchSource === TOUCH_SOURCE.Kick) {
                let kickType;
                if (lastTouchPlayer.team === newTouchPlayer.team) {
                    kickType = KICK_TYPE.Pass;
                } else {
                    const gp = goalposts[newTouchPlayer.team];
                    const nearGoal = inGoalArea(gp, newTouchPlayer.position);
                    if (nearGoal) {
                        kickType = KICK_TYPE.Save;
                    } else {
                        kickType = KICK_TYPE.Steal;
                    }
                }
                const kick = {
                    time,
                    type: kickType,
                    from: flattenPlayer(lastTouchPlayer),
                    to: flattenPlayer(newTouchPlayer),
                    score,
                };
                kicks.push(kick);
                streamData(db, currentStreamId, saveAllTimeKick(kick, null));
                if (kickType === KICK_TYPE.Save) {
                    room.sendDebug(`Save by ${newTouchPlayer.name} against ${lastTouchPlayer.name}`);
                } else if (kickType === KICK_TYPE.Steal) {
                    room.sendDebug(`Stolen by ${newTouchPlayer.name} from ${lastTouchPlayer.name}`);
                } else if (kickType === KICK_TYPE.Pass) {
                    room.sendDebug(`Pass from ${lastTouchPlayer.name} to ${newTouchPlayer.name}`);
                }
            }
            room.sendDebug(`Possession change from ${lastTouchPlayer.name} to ${newTouchPlayer.name}`);
            // Update last touch
            lastTouchPlayer = newTouchPlayer;
            lastTouchSource = fromKick ? TOUCH_SOURCE.Kick : TOUCH_SOURCE.Touch;
            possessionStartTime = time;
        } else if (fromKick) {
            // Even if the same person touched it, override touch with kick.
            lastTouchPlayer = newTouchPlayer;
            lastTouchSource = fromKick ? TOUCH_SOURCE.Kick : TOUCH_SOURCE.Touch;
        }
    }
}

room.onGameTick = function() {
    if (matchPlayersMap === null) {
        return;
    }
    const time = getTime(room);
    const delta = time - lastPositionSaveTime;
    lastClockTime = time;
    // Save player positions
    const players = room.getPlayerList();
    const b = room.getBallPosition();
    let newTouchPlayer = null;
    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        if (player.position !== null) {
            // Save player in the map of match players, in case they leave or are subbed.
            matchPlayersMap[player.id] = player;
            // Check if player is touching the ball.
            const p = player.position;
            const d = Math.sqrt(
                Math.pow(b.x - p.x, 2) + Math.pow(b.y - p.y, 2)
            );
            const hasBall = d < TOUCH_THRESHOLD;
            if (hasBall) {
                newTouchPlayer = player;
            }
            if (delta > POSITION_SAVE_COOLDOWN) {
                const pos = {
                    time: time,
                    type: POSITION_TYPE.Player,
                    x: p.x,
                    y: p.y,
                    id: player.id,
                    hasBall,
                };
                positions.push(pos);
            }
        }
    }
    // Update possession
    updateTouched(newTouchPlayer, fromKick=false);
    // Save ball position
    if (delta > POSITION_SAVE_COOLDOWN) {
        const pos = {
            time: time,
            type: POSITION_TYPE.Ball,
            x: b.x,
            y: b.y,
            player: lastTouchPlayer ? lastTouchPlayer.id : null,
            team: lastTouchPlayer ? lastTouchPlayer.team : null,
        };
        positions.push(pos);
        // Update last position save time after ball is stored.
        lastPositionSaveTime = time;
    }
}

room.onPlayerBallKick = function(player) {
    const time = getTime(room);
    const ball = room.getBallPosition();
    prevKickPlayer = lastKickPlayer;
    lastKickPlayer = player;
    lastKickAt = time;
    updateTouched(player, fromKick=true);
}

room.onTeamGoal = function(team) {
    // Save goal record
    const time = getTime(room);
    const ball = room.getBallPosition();
    const score = room.getScores();
    // Kicks update last touch, so the scorer should always be the last touch.
    // We always consider the last player to touch the ball as the scorer.
    // However, we also record "errors" so that in individual analytics, we can
    // award the kicker with a kick that led to an own goal.
    const scorer = lastTouchPlayer;
    // Depending on the source of last touch, consider different assist candidate.
    let assist = null;
    if (lastTouchSource === TOUCH_SOURCE.Kick) {
        assist = getAssister(lastKickPlayer, prevKickPlayer, team);
    } else {
        assist = getAssister(lastTouchPlayer, lastKickPlayer, team);
    };
    const isOwn = scorer !== null ? scorer.team !== team : false;
    const goal = {
        team,
        isOwn,
        scoreRed: score.red,
        scoreBlue: score.blue,
        time,
        ball,
        scorer: flattenPlayer(scorer),
        assist: flattenPlayer(assist),
    };
    goals.push(goal);
    // Check if save was valid
    if (kicks.length > 0) {
        const tailKick = kicks.pop();
        const wasSaved = tailKick.type === KICK_TYPE.Save;
        const scoredBySaver = tailKick.to && scorer ? tailKick.to.id === scorer.id : false;
        // If the saver made a save then kicked it in, record a save, then an own goal.
        // If the saver made a save, but then the ball went in, or they pushed it in,
        // change the save to an error, then record the own goal. Now the kicker gets
        // credit for a shot that was not saved, but the goal is still an own goal.
        const notKickedIn = !(lastTouchSource === TOUCH_SOURCE.Kick);
        if (wasSaved && scoredBySaver && notKickedIn) {
            const errorKick = {
                time: tailKick.time,
                type: KICK_TYPE.Error,
                from: tailKick.from,
                to: tailKick.to,
                score,
                correction: true,
            };
            kicks.push(errorKick);
            streamData(db, currentStreamId, {
                ...saveAllTimeKick(errorKick, null),
                correction: true,
            });
            room.sendDebug(`Save changed to error by ${tailKick.to.name}`);
        } else {
            kicks.push(tailKick);
        }
    }
    // Save goal as kick also
    const kick = {
        time,
        type: isOwn ? KICK_TYPE.OwnGoal : KICK_TYPE.Goal,
        from: flattenPlayer(scorer),
        to: null,
        assist: flattenPlayer(assist),
        score,
    };
    kicks.push(kick);
    streamData(db, currentStreamId, saveAllTimeKick(kick, null));
    // Record and update team possession
    const drive = {
        start: possessionStartTime,
        end: time,
        player: lastTouchPlayer ? lastTouchPlayer.id : null,
        team: lastTouchPlayer ? lastTouchPlayer.team : null,
    };
    possessions.push(drive);
    // Reset game state
    prevKickPlayer = null;
    lastKickPlayer = null;
    lastTouchPlayer = null;
    lastTouchSource = null;
    possessionStartTime = time;
    // Announce goal
    const scorerName = goal.scorer ? goal.scorer.name : "no one";
    const assistName = goal.assist ? goal.assist.name : "---";
    const goalMsg = `${isOwn ? "Own goal" : "Goal"} for ${TEAMS[team]}`;
    room.sendAnnouncement(`${goalMsg} at ${toClock(getTime(room))}!`);
    room.sendAnnouncement(`By: ${scorerName} | Assist: ${assistName}`);
}

room.onPlayerChat = function(player, message) {
    if (message.indexOf("!map") === 0) {
        const bounds = positions.reduce((agg, pos) => {
            agg.minX = Math.min(agg.minX, pos.x);
            agg.maxX = Math.max(agg.maxX, pos.x);
            agg.minY = Math.min(agg.minY, pos.y);
            agg.maxY = Math.max(agg.maxY, pos.y);
            return agg;
        }, {
            minX: Infinity,
            maxX: -1 * Infinity,
            minY: Infinity,
            maxY: -1 * Infinity,
        });
        const mapData = {
            stadium: currentStadiumName,
            goalposts,
            bounds,
            ball: { radius: BALL_RADIUS, },
        };
        room.sendAnnouncement(JSON.stringify(mapData), targetId=player.id);
        return false;
    }
    if (message.indexOf("!p") === 0) {
        const playerList = room.getPlayerList().filter((p) => {
            if (message.indexOf("red") > -1) {
                return p.team === TEAMS.Red;
            } else if (message.indexOf("blue") > -1) {
                return p.team === TEAMS.Blue;
            } else if (message.indexOf("in") > -1) {
                return p.team === TEAMS.Red || p.team === TEAMS.Blue;
            } else if (message.indexOf("out") > -1) {
                return p.team !== TEAMS.Red && p.team !== TEAMS.Blue;
            }
            return true;
        }).map((p) => p.name).join(",");
        room.sendAnnouncement(playerList, targetId=player.id);
        return false;
    }
    if (message.indexOf("!top") === 0 && possessions) {
        // Total time of match, in seconds.
        let totalTOP = 0;
        // Total time of possession for each team, in seconds.
        let teamTOPMap = {
            [TEAMS.Red]: 0,
            [TEAMS.Blue]: 0,
        };
        // Total time of posession for each player on each team, in seconds.
        let playerTOPMap = {
            [TEAMS.Red]: {},
            [TEAMS.Blue]: {},
        };
        const current = [
            ...possessions,
            {
                start: possessionStartTime,
                end: lastClockTime,
                player: lastTouchPlayer ? lastTouchPlayer.id : null,
                team: lastTouchPlayer ? lastTouchPlayer.team : null,
            },
        ];
        current.forEach((drive) => {
            const dur = drive.end - drive.start;
            totalTOP += dur;
            if (drive.team && drive.player) {
                teamTOPMap[drive.team] += dur;
                if ((drive.player in playerTOPMap)) {
                    playerTOPMap[drive.team][drive.player] = 0;
                }
                playerTOPMap[drive.team][drive.player] += dur;   
            }
        });
        const redTOPPct = totalTOP > 0 ? Math.round(100 * (teamTOPMap[TEAMS.Red] / totalTOP)) : 0;
        const blueTOPPct = totalTOP > 0 ? Math.round(100 * (teamTOPMap[TEAMS.Blue] / totalTOP)) : 0;
        const msg = [
            `Time of Possession:`,
            `Red: ${teamTOPMap[TEAMS.Red].toFixed(0)} secs (${redTOPPct}%)`,
            `Blue: ${teamTOPMap[TEAMS.Blue].toFixed(0)} secs (${blueTOPPct}%)`,
        ];
        if (message.indexOf("all") > -1) {
            room.sendAnnouncement(msg.join("\n"));
        } else {
            room.sendAnnouncement(msg.join("\n"), targetId=player.id);
        }
        return false;
    }
}
