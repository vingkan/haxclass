const TEAMS = { 1: "red", 2: "blue", "1": "red", "2": "blue", Red: 1, Blue: 2 };
const PLAYER_RADIUS = 15;
const GOAL_AREA_RADIUS = 1.5;
const REPLAY_TICK = 25;
const POST_GOAL_WAIT_TICKS = 50;

function inflate(packed) {
    const playerMap = packed.players.reduce((agg, player) => {
        agg[player.id] = player;
        return agg;
    }, {});
    const players = packed.players.map((p) => {
        return {
            id: p.id,
            name: p.name,
            team: TEAMS[p.team],
        };
    });
    const goals = packed.goals.map((l) => {
        const d = l.split(",");
        const scorerId = parseInt(d[6]);
        const scorer = playerMap[scorerId];
        const assistId = d.length > 9 ? parseInt(d[9]) : null;
        const assist = playerMap[assistId];
        return {
            time: parseFloat(d[0]),
            team: TEAMS[d[1]],
            scoreRed: parseInt(d[2]),
            scoreBlue: parseInt(d[3]),
            ballX: parseFloat(d[4]),
            ballY: parseFloat(d[5]),
            scorerId,
            scorerX: parseFloat(d[7]),
            scorerY: parseFloat(d[8]),
            scorerName: scorer.name,
            scorerTeam: TEAMS[scorer.team],
            assistId,
            assistX: d.length > 10 ? parseFloat(d[10]) : null,
            assistY: d.length > 11 ? parseFloat(d[11]) : null,
            assistName: assist ? assist.name : null,
            assistTeam: assist ? TEAMS[assist.team] : null,
        };
    });
    const kicks = packed.kicks.map((l) => {
        const d = l.split(",");
        const fromId = parseInt(d[2]);
        const fromPlayer = playerMap[fromId];
        const toId = d.length > 5 ? parseInt(d[5]) : null;
        const toPlayer = playerMap[toId];
        return {
            time: parseFloat(d[0]),
            type: d[1],
            fromId,
            fromX: parseFloat(d[3]),
            fromY: parseFloat(d[4]),
            fromName: fromPlayer.name,
            fromTeam: TEAMS[fromPlayer.team],
            toId,
            toX: d.length > 6 ? parseFloat(d[6]) : null,
            toY: d.length > 7 ? parseFloat(d[7]) : null,
            toName: toPlayer ? toPlayer.name : null,
            toTeam: toPlayer ? TEAMS[toPlayer.team] : null,
        };
    });
    const possessions = packed.possessions.map((l) => {
        const d = l.split(",");
        const playerId = parseInt(d[2]);
        const player = playerMap[playerId];
        return {
            start: parseFloat(d[0]),
            end: parseFloat(d[1]),
            playerId,
            playerName: player.name,
            team: TEAMS[player.team],
        };
    });
    const positions = packed.positions.map((l) => {
        const d = l.split(",");
        const isPlayer = d.length === 4;
        const playerId = isPlayer ? parseInt(d[3]) : null;
        const player = playerMap[playerId];
        return {
            type: isPlayer ? "player" : "ball",
            time: parseFloat(d[0]),
            x: parseFloat(d[1]),
            y: parseFloat(d[2]),
            playerId,
            name: player ? player.name : null,
            team: player ? TEAMS[player.team] : null,
        };
    });
    return {
        saved: packed.saved,
        score: packed.score,
        stadium: packed.stadium,
        players,
        goals,
        kicks,
        possessions,
        positions,
    };
}

function parseStadiumDataMap(data) {
    return data.reduce((agg, val) => {
        const sizeX = val.bounds.maxX - val.bounds.minX;
        const sizeY = val.bounds.maxY - val.bounds.minY;
        const midX = (sizeX / 2) + val.bounds.minX;
        const midY = (sizeY / 2) + val.bounds.minY;
        agg[val.stadium] = {
            ...val,
            field: { sizeX, sizeY, midX, midY, },
        };
        return agg;
    }, {});
}

function getMatchFromFirebase(mid, db) {
    return new Promise((resolve, reject) => {
        db.ref(`match/${mid}`).once("value", (snap) => {
            const packed = snap.val();
            if (packed) {
                const match = inflate(packed);
                resolve(match);
            } else {
                reject({
                    error: `No data for match ID: ${mid}`
                });
            }
        }).catch(reject);
    });
}

async function getMatchFromLocal(mid) {
    return new Promise(async (resolve, reject) => {
        const res = await fetch(`../records/${mid}.json`).catch(reject);
        const packed = await res.json();
        const match = inflate(packed);
        resolve(match);
    });
}

function leftpad(val) {
    return val < 10 ? `0${val}` : `${val}`;
}

function toClock(secs) {
    const s = Math.floor(secs);
    return `${Math.floor(s / 60)}:${leftpad(s % 60)}`;
}

function makeSvgEl(tag, props) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (let key in props) {
        el.setAttribute(key, props[key]);
    }
    return el;
}

function makeArcPath(props) {
    const { x1, y1, x2, y2, sweep } = props;
    const d = `M ${x1} ${y1} A 1 1, 0, 0 ${sweep}, ${x2} ${y2}`;
    return d;
}

function drawFieldAndGoals(svgEl, toX, toY, stadium) {
    svgEl.setAttribute("viewBox", `0 0 ${stadium.field.sizeX} ${stadium.field.sizeY}`);
    svgEl.appendChild(makeSvgEl("rect", {
        width: stadium.field.sizeX,
        height: stadium.field.sizeY,
        fill: "gray",
    }));
    svgEl.appendChild(makeSvgEl("line", {
        x1: toX(stadium.field.midX),
        y1: toY(stadium.bounds.minY),
        x2: toX(stadium.field.midX),
        y2: toY(stadium.bounds.maxY),
        stroke: "white",
        "stroke-width": 2,        
    }));
    const gpRed = stadium.goalposts[TEAMS.Red];
    const gpBlue = stadium.goalposts[TEAMS.Blue];
    const goalAreaRadius = GOAL_AREA_RADIUS * gpRed.size / 2;
    const goalposts = [ ...gpRed.posts, ...gpBlue.posts, ];
    for (let k = 0; k < goalposts.length; k++) {
        const { x, y } = goalposts[k];
        const postEl = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        postEl.setAttribute("cx", toX(x));
        postEl.setAttribute("cy", toY(y));
        postEl.setAttribute("r", 5);
        postEl.setAttribute("fill", "white");
        svgEl.appendChild(postEl);
    }
    const goalCoordsRed = {
        x1: toX(goalposts[0].x),
        y1: toY(gpRed.mid.y - goalAreaRadius),
        x2: toX(goalposts[1].x),
        y2: toY(gpRed.mid.y + goalAreaRadius),
    }
    svgEl.appendChild(makeSvgEl("line", {
        ...goalCoordsRed,
        y1: toY(stadium.bounds.minY),
        y2: toY(stadium.bounds.maxY),
        stroke: "white",
        "stroke-width": 2,
    }));
    svgEl.appendChild(makeSvgEl("path", {
        d: makeArcPath({
            ...goalCoordsRed,
            sweep: 1,
        }),
        fill: "none",
        stroke: "white",
        "stroke-width": 2,
        "stroke-dasharray": "10",
    }));
    const goalCoordsBlue = {
        x1: toX(goalposts[2].x),
        y1: toY(gpBlue.mid.y - goalAreaRadius),
        x2: toX(goalposts[3].x),
        y2: toY(gpBlue.mid.y + goalAreaRadius),
    }
    svgEl.appendChild(makeSvgEl("line", {
        ...goalCoordsBlue,
        y1: toY(stadium.bounds.minY),
        y2: toY(stadium.bounds.maxY),
        stroke: "white",
        "stroke-width": 2,
    }));
    svgEl.appendChild(makeSvgEl("path", {
        d: makeArcPath({
            ...goalCoordsBlue,
            sweep: 0,
        }),
        fill: "none",
        stroke: "white",
        "stroke-width": 2,
        "stroke-dasharray": "10",
    }));
}

function drawBallAndPlayers(svgEl, toX, toY, stadium, match) {
    let discElMap = {};
    let textElMap = {};
    for (let i = 0; i <= match.players.length; i++) {
        // If we loop back around to the ball, we've drawn all the initial players.
        if ("ball" in discElMap) {
            break;
        }
        if (match.positions[i].type === "ball") {
            const ball = match.positions[i];
            const ballEl = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            ballEl.setAttribute("cx", toX(ball.x));
            ballEl.setAttribute("cy", toY(ball.y));
            ballEl.setAttribute("r", stadium.ball.radius);
            ballEl.setAttribute("fill", "lime");
            svgEl.appendChild(ballEl);
            discElMap["ball"] = ballEl;
        } else {
            const pos = match.positions[i];
            const playerEl = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            playerEl.setAttribute("cx", toX(pos.x));
            playerEl.setAttribute("cy", toY(pos.y));
            playerEl.setAttribute("r", PLAYER_RADIUS);
            playerEl.setAttribute("fill", pos.team);
            const textEl = makeSvgEl("text", {
                x: toX(pos.x),
                y: toY(pos.y),
                dy: (7 / 3) * PLAYER_RADIUS,
                fill: "white",
                "text-anchor": "middle",
                "font-family": "sans-serif",
                "font-size": (4 / 3) * PLAYER_RADIUS,
            });
            textEl.innerHTML = pos.name;
            svgEl.appendChild(playerEl);
            svgEl.appendChild(textEl);
            discElMap[pos.playerId] = playerEl;
            textElMap[pos.playerId] = textEl;
        }
    }
    // Draw players that were not in at the start of the game.
    const { minX, maxX, minY } = stadium.bounds;
    for (let b = 0; b < match.players.length; b++) {
        const player = match.players[b];
        if (!(player.id in discElMap)) {
            const cornerX = player.team === TEAMS.Red ? minX : maxX;
            const cornerY = minY;
            const playerEl = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            playerEl.setAttribute("cx", toX(cornerX));
            playerEl.setAttribute("cy", toY(cornerY));
            playerEl.setAttribute("r", PLAYER_RADIUS);
            playerEl.setAttribute("fill", player.team);
            const textEl = makeSvgEl("text", {
                x: toX(cornerX),
                y: toY(cornerY),
                dy: (7 / 3) * PLAYER_RADIUS,
                fill: "white",
                "text-anchor": "middle",
                "font-family": "sans-serif",
                "font-size": (4 / 3) * PLAYER_RADIUS,
            });
            textEl.innerHTML = player.name;
            svgEl.appendChild(playerEl);
            svgEl.appendChild(textEl);
            discElMap[player.id] = playerEl;
            textElMap[player.id] = textEl;
        }
    }
    return { discElMap, textElMap };
}

let playMatchInterval = null;

function playMatch(
    match, moments, stadium,
    discElMap, textElMap,
    toX, toY, setScore, setClock, logMsg, clearLog,
    startTime=0, tick=20
) {
    // Stop previous render loop and reset player.
    clearInterval(playMatchInterval);
    setClock(startTime);
    clearLog();
    // Match time in seconds.
    let time = startTime;
    // Index in the match positions array to render.
    let t = 0;
    // Whether or not there are still positions to draw.
    let running = true;
    // Current clock face time of the match.
    let clock = toClock(time);
    // Update the score and log with the next match moment.
    const renderMoment = (next) => {
        let c = toClock(next.time);
        if (next.scoreRed ||next.scoreBlue) {
            setScore(next);
            if (next.team !== next.scorerTeam) {
                logMsg(c, `Own goal by ${next.scorerName}.`);
            } else {
                const a = next.assistName ? `, assist by ${next.assistName}.` : ".";
                logMsg(c, `Goal by ${next.scorerName}${a}`);
            }
        }
        switch (next.type) {
            case "pass":
                logMsg(c, `Pass from ${next.fromName} to ${next.toName}.`);
                break;
            case "steal":
                logMsg(c, `Stolen by ${next.toName}.`);
                break;
            case "save":
                logMsg(c, `Saved by ${next.toName}.`);
                break;
            case "error":
                logMsg(c, `${next.fromName} scored on error by ${next.toName}`);
                break;
        }
    };
    const renderPos = (pos) => {
        const { x, y } = pos;
        if (pos.type === "player") {
            const playerEl = discElMap[pos.playerId];
            playerEl.setAttribute("cx", toX(x));
            playerEl.setAttribute("cy", toY(y));
            const textEl = textElMap[pos.playerId];
            textEl.setAttribute("x", toX(x));
            textEl.setAttribute("y", toY(y));
        } else {
            const ballEl = discElMap["ball"];
            ballEl.setAttribute("cx", toX(x));
            ballEl.setAttribute("cy", toY(y));
        }
    }
    for (let f = 0; f <= match.players.length; f++) {
        renderPos(match.positions[f]);
    }
    // Update position block counter t based on requested start time.
    while (match.positions[t] && match.positions[t].time < time) {
        // All positions in a block have the same time, so this loop
        // will find the first position index for the correct block.
        renderPos(match.positions[t]);
        t++;
    }
    // Update next moment based on requested start time.
    let next = moments.shift();
    while (next && next.time < time) {
        renderMoment(next);
        next = moments.shift();
    }
    // Render match from the requested start time onward.
    if (time === 0) {
        logMsg(clock, `Game started.`);
    } else {
        logMsg(null, `Jumped to ${clock}.`);
    }
    let waitCounter = 0;
    playMatchInterval = setInterval(() => {
        // Render player and ball positions.
        for (let j = t; j <= t + match.players.length; j++) {
            const pos = match.positions[j];
            if (!pos) {
                running = false;
                break;
            }
            time = pos.time;
            if (j === t) {
                clock = toClock(time);
                setClock(time);
            }
            renderPos(pos);
        }
        if (waitCounter > 0) {
            waitCounter--;
            return;
        }
        // Log moments that happened between time steps.
        while (next && (next.time < time || !running)) {
            renderMoment(next);
            if (next.scoreRed || next.scoreBlue) {
                waitCounter = POST_GOAL_WAIT_TICKS;
            }
            next = moments.shift();
            if (!next) break;
        }
        // Stop rendering the match.
        if (!running) {
            clearInterval(playMatchInterval);
            logMsg(clock, `Game ended.`);
            return;
        }
        // Increment the position block counter.
        t++;
    }, tick);
}

async function mainReplay(match) {

    console.log(match)

    // Load stadium data.
    const stadiumRes = await fetch(`../stadium/map_data.json`).catch(console.error);
    const stadiumDataMap = parseStadiumDataMap(await stadiumRes.json());
    if (!(match.stadium in stadiumDataMap)) {
        throw new Error(`Missing stadium data for: ${match.stadium}`);
    }
    const stadium = stadiumDataMap[match.stadium];

    // Render stadium.
    const svgEl = document.querySelector("svg");
    const toX = (x) => {
        return x - stadium.bounds.minX;
    };
    const toY = (y) => {
        return y - stadium.bounds.minY;
    };
    try {
        drawFieldAndGoals(svgEl, toX, toY, stadium);
    } catch (err) {
        console.log("Error while drawing field and goals:");
        console.log(err);
    }
    const { discElMap, textElMap } = drawBallAndPlayers(svgEl, toX, toY, stadium, match);

    // Set up player.
    const scoreEl = document.getElementById("score");
    const clockEl = document.getElementById("clock");
    const logMsgEl = document.getElementById("log-message");
    const logClockEl = document.getElementById("log-clock");
    const fullLogEl = document.getElementById("full-log");
    const playBtn = document.getElementById("play");
    const sliderEl = document.getElementById("slider");
    const stadiumNameEl = document.getElementById("stadium-name");
    slider.setAttribute("min", 0);
    slider.setAttribute("max", Math.ceil(match.score.time));
    slider.setAttribute("step", 1);
    slider.setAttribute("value", 0);
    stadiumNameEl.innerText = match.stadium;
    const logMsg = (clock, m) => {
        if (clock) {
            logClockEl.innerText = clock;
        }
        logMsgEl.innerText = m;
        const p = document.createElement("p");
        if (clock) {
            p.innerText = `${clock} - ${m}`;
        } else {
            p.innerText = m;
        }
        fullLogEl.prepend(p);
    };
    const setScore = (next) => {
        scoreEl.innerText = `${next.scoreRed} - ${next.scoreBlue}`;
    };
    const setClock = (time) => {
        const clock = toClock(time);
        clockEl.innerText = clock;
        sliderEl.value = Math.floor(time);
    };
    const clearLog = () => {
        fullLogEl.innerHTML = "";
    };

    // Set up game loop.
    const moments = [ ...match.goals, ...match.kicks, ].sort((a, b) => {
        return a.time - b.time;
    });
    const startMatchFrom = (time) => {
        playMatch(
            match, [ ...moments ], stadium,
            discElMap, textElMap,
            toX, toY, setScore, setClock, logMsg, clearLog,
            startTime=time, tick=REPLAY_TICK
        );
    }

    // Set up playback controls.
    playBtn.addEventListener("click", (e) => {
        if (playBtn.value === "Play") {
            startMatchFrom(parseInt(slider.value));
            playBtn.value = "Pause";    
        } else {
            clearInterval(playMatchInterval);
            playBtn.value = "Play";
        }
        
    });
    slider.addEventListener("input", (e) => {
        startMatchFrom(parseInt(slider.value));
        clearInterval(playMatchInterval);
        playBtn.value = "Play";
    });

}
