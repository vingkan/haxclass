const TEAMS = { 1: "red", 2: "blue", "1": "red", "2": "blue", Red: 1, Blue: 2 };
const PLAYER_RADIUS = 15;
const GOAL_AREA_RADIUS = 1.5;

function getParam(url, tag) {
    if (url.indexOf(`${tag}=`) > -1) {
        return url.split(`${tag}=`)[1].split("&")[0];
    }
    return null;
}

function plur(n, s, p) {
    const ps = p ? p : `${s}s`;
    return n === 1 ? `${n} ${s}` : `${n} ${ps}`;
}

function leftpad(val) {
    return val < 10 ? `0${val}` : `${val}`;
}

function toClock(secs) {
    const s = Math.floor(secs);
    return `${leftpad(Math.floor(s / 60))}:${leftpad(s % 60)}`;
}

function limitChars(s, c) {
    return s.length < c ? s : `${s.substr(0, c)}...`;
}

function toList(map) {
    return Object.keys(map).map((k) => map[k]);
}

function initializeData() {
    return {
        nEvents: 0,
        stadium: null,
        isFinal: false,
        isOT: false,
        time: 0,
        timeLimit: 0,
        scoreLimit: 0,
        score: {
            red: 0,
            blue: 0,
        },
        players: {
            red: {},
            blue: {},
        },
        kicks: [],
        gainedPossessionAt: 0,
        possessor: null,
    };
}

function initializePlayer(playerMap, team, name) {
    if (!team || !name) {
        return null;
    } else if (name in playerMap[team]) {
        return playerMap[team][name];
    } else {
        return {
            team,
            name,
            goalsScored: 0,
            shotsTaken: 0,
            shotsFaced: 0,
            savesMade: 0,
            ownGoals: 0,
            passesAttempted: 0,
            passesCompleted: 0,
            passesReceived: 0,
            stealsTaken: 0,
            stealsGiven: 0,
            timePossessed: 0,
        };
    }
}


// https://coolors.co/59cd90-d90368-3fa7d6-f79d84-ffd400
const PLAYER_COLORS = [
    `217, 3, 104`,
    `63, 167, 214`,
    `255, 212, 0`,
    `89, 205, 144`,
];

function reduceLive(d, v, stadiums) {
    const stadium = d.stadium ? stadiums[d.stadium] || null : null;
    d.nEvents++;
    let fromPlayer = initializePlayer(d.players, v.fromTeam, v.fromName);
    let toPlayer = initializePlayer(d.players, v.toTeam, v.toName);
    // Update score and time.
    d.score.red = v.scoreRed ? v.scoreRed : d.score.red;
    d.score.blue = v.scoreBlue ? v.scoreBlue : d.score.blue;
    d.scoreLimit = v.scoreLimit ? v.scoreLimit : d.scoreLimit;
    d.timeLimit = v.timeLimit ? v.timeLimit : d.timeLimit;
    d.time = v.time ? v.time : d.time;
    d.isOT = d.time > d.timeLimit;
    // Compute kick metrics.
    if (v.type === "pass") {
        if (fromPlayer.name !== toPlayer.name) {
            fromPlayer.passesAttempted++;
            fromPlayer.passesCompleted++;
            toPlayer.passesReceived++;
        }
    }
    if (v.type === "steal") {
        fromPlayer.passesAttempted++;
        fromPlayer.stealsGiven++;
        toPlayer.stealsTaken++;
    }
    if (v.type === "goal") {
        fromPlayer.shotsTaken++;
        fromPlayer.goalsScored++;
    }
    // Only use errors to count offensive stats and correct defensive saves.
    // Use own goals to count defensive errors, as an error is always followed by an own goal,
    // but an own goal is not always preceded by an error.
    if (v.type === "error") {
        fromPlayer.goalsScored++;
        // Undo the effects of the previous save, as if it never happened.
        if (v.correction) {
            // Decrement shotsFaced so that own goal can increment it.
            toPlayer.shotsFaced--;
            toPlayer.savesMade--;
        }
    }
    if (v.type === "own_goal") {
        fromPlayer.shotsFaced++;
        fromPlayer.ownGoals++;
    }
    if (v.type === "save") {
        fromPlayer.shotsTaken++;
        toPlayer.shotsFaced++;
        toPlayer.savesMade++;
    }
    // Save kicks to display.
    if (stadium) {
        const rgb = v.fromTeam === "red" ? `217, 3, 104` : `63, 167, 214`;
        const gpRed = stadium.goalposts[TEAMS.Red];
        const gpBlue = stadium.goalposts[TEAMS.Blue];
        if (v.type === "goal" || v.type === "error") {
            const gp = v.fromTeam === "red" ? gpBlue : gpRed;
            d.kicks.push({
                color: `rgba(${rgb}, 0.90)`,
                ...v,
                toX: gp.mid.x,
                toY: gp.mid.y,
            });
        }
        if (v.type === "own_goal") {
            const gp = v.fromTeam === "red" ? gpRed : gpBlue;
            d.kicks.push({
                color: `rgba(${rgb}, 0.90)`,
                ...v,
                toX: gp.mid.x,
                toY: gp.mid.y,
            });
        }
        if (v.type === "save") {
            d.kicks.push({
                color: `rgba(${rgb}, 0.90)`,
                ...v,
            });
        }
    }
    // Compute time of possession.
    if (fromPlayer) {
        d.possessor = d.possessor ? d.possessor : fromPlayer.name;
        const possessionDuration = v.time - d.gainedPossessionAt;
        // Even if the previous possessor is not fromPlayer, we will give fromPlayer the time.
        fromPlayer.timePossessed += possessionDuration;
        if (!toPlayer) {
            d.possessor = null;
        } else if (toPlayer.name !== fromPlayer.name) {
            d.possessor = toPlayer.name;
        }
        d.gainedPossessionAt = v.time;
    }
    // Update player entries.
    if (fromPlayer) {
        d.players[fromPlayer.team][fromPlayer.name] = fromPlayer;
    }
    if (toPlayer) {
        d.players[toPlayer.team][toPlayer.name] = toPlayer;
    }
    if (v.type === "start") {
        d.stadium = v.stadium;
    }
    if (v.type === "victory") {
        d.isFinal = true;
    }
    return d;
}

function tableOffense(playerMap) {
    const headers = [
        { key: "name", name: "Player" },
        { key: "goalsScored", name: "Goals" },
        { key: "shotsTaken", name: "Shots" },
        { key: "passes", name: "Passes" },
    ];
    const rows = toList(playerMap).map((p) => {
        return {
            name: limitChars(p.name, 20),
            goalsScored: p.goalsScored,
            shotsTaken: p.shotsTaken,
            passesCompleted: p.passesCompleted,
            passesAttempted: p.passesAttempted,
            passes: `${p.passesCompleted} / ${p.passesAttempted}`,
        }
    }).sort((a, b) => {
        if (a.goalsScored === b.goalsScored) {
            if (a.shotsTaken === b.shotsTaken) {
                if (a.passesCompleted === b.passesCompleted) {
                    return b.passesAttempted - a.passesAttempted;
                }
                return b.passesCompleted - a.passesCompleted;
            }
            return b.shotsTaken - a.shotsTaken;
        }
        return b.goalsScored - a.goalsScored;
    });
    return { headers, rows };
}

function tableDefense(playerMap) {
    const headers = [
        { key: "name", name: "Player" },
        { key: "ownGoals", name: "Own Goals" },
        { key: "saves", name: "Save Attempts" },
        { key: "stealsTaken", name: "Steals" },
    ];
    const rows = toList(playerMap).map((p) => {
        return {
            name: limitChars(p.name, 20),
            ownGoals: p.ownGoals,
            savesMade: p.savesMade,
            shotsFaced: p.shotsFaced,
            stealsTaken: p.stealsTaken,
            saves: `${p.savesMade} / ${p.shotsFaced}`,
        }
    }).sort((a, b) => {
        if (a.shotsFaced === b.shotsFaced) {
            return b.steals - a.steals;
        }
        return b.shotsFaced - a.shotsFaced;
    });
    return { headers, rows };
}

function StatsTable(props) {
    const { headers, rows } = props.table;
    const getCells = (p) => {
        return headers.map((col) => {
            return <td>{p[col.key]}</td>
        });
    };
    const getRow = (p) => {
        return <tr>{getCells(p)}</tr>;
    };
    return (
        <div className="StatsTable Full">
            <table>
                <thead>
                    {headers.map((col) => {
                        return <th>{col.name}</th>
                    })}
                </thead>
                <tbody>
                    {rows.map(getRow)}
                </tbody>
            </table>
        </div>
    );
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

async function loadStadiumData() {
    const stadiumRes = await fetch(`../stadium/map_data.json`).catch(console.error);
    const stadiumDataMap = parseStadiumDataMap(await stadiumRes.json());
    return stadiumDataMap;
}

function makeArcPath(props) {
    const { x1, y1, x2, y2, sweep } = props;
    const d = `M ${x1} ${y1} A 1 1, 0, 0 ${sweep}, ${x2} ${y2}`;
    return d;
}

function Field(props) {
    const s = props.stadium;
    const hasStadium = Object.keys(s).length > 0;
    if (!hasStadium) {
        return (
            <p>No stadium selected.</p>
        );
    }
    const hasGoalPosts = s.goalposts[TEAMS.Red] && s.goalposts[TEAMS.Blue];
    if (!hasGoalPosts) {
        return (
            <p>No goalposts found for this stadium.</p>
        );
    }
    const kicks = props.kicks;
    const toX = (x) => {
        return x - s.bounds.minX;
    };
    const toY = (y) => {
        return y - s.bounds.minY;
    };
    const viewBoxDim = `0 0 ${s.field.sizeX} ${s.field.sizeY}`;
    const gpRed = s.goalposts[TEAMS.Red];
    const gpBlue = s.goalposts[TEAMS.Blue];
    const goalAreaRadius = GOAL_AREA_RADIUS * gpRed.size / 2;
    const goalposts = [ ...gpRed.posts, ...gpBlue.posts, ];
    const goalCoordsRed = {
        x1: toX(goalposts[0].x),
        y1: toY(gpRed.mid.y - goalAreaRadius),
        x2: toX(goalposts[1].x),
        y2: toY(gpRed.mid.y + goalAreaRadius),
    };
    const goalCoordsBlue = {
        x1: toX(goalposts[2].x),
        y1: toY(gpBlue.mid.y - goalAreaRadius),
        x2: toX(goalposts[3].x),
        y2: toY(gpBlue.mid.y + goalAreaRadius),
    };
    const goalLines = [goalCoordsBlue, goalCoordsRed];
    return (
        <div className="Field">
            <svg viewBox={viewBoxDim} xmlns="http://www.w3.org/2000/svg">
                <rect
                    className="field-pitch"
                    width={s.field.sizeX}
                    height={s.field.sizeY}
                />
                <line
                    className="field-line"
                    x1={toX(s.field.midX)}
                    y1={toY(s.bounds.minY)}
                    x2={toX(s.field.midX)}
                    y2={toY(s.bounds.maxY)}
                />
                {goalposts.map(({ x, y }) => {
                    return (
                        <circle
                            cx={toX(x)}
                            cy={toY(y)}
                            r={5}
                            fill="white"
                        />
                    );
                })}
                {goalLines.map((goalCoords, sweep) => {
                    return (
                        <line
                            className="field-line"
                            x1={goalCoords.x1}
                            x2={goalCoords.x2}
                            y1={toY(s.bounds.minY)}
                            y2={toY(s.bounds.maxY)}
                        />
                    );
                })}
                {goalLines.map((goalCoords, sweep) => {
                    return (
                        <path
                            className="field-line dashed"
                            d={makeArcPath({ ...goalCoords, sweep })}
                            fill="none"
                        />
                    );
                })}
                {kicks.map((kick) => {
                    return (
                        <circle
                            className={`player`}
                            cx={toX(kick.fromX)}
                            cy={toY(kick.fromY)}
                            r={5}
                            fill={kick.color}
                        />
                    );
                })}
                {kicks.map((kick) => {
                    return (
                        <line
                            className={`shot goal`}
                            x1={toX(kick.fromX)}
                            y1={toY(kick.fromY)}
                            x2={toX(kick.toX)}
                            y2={toY(kick.toY)}
                            stroke={kick.color}
                        />
                    );
                })}
            </svg>
        </div>
    );
}

class LiveMain extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            isLoading: props.stadiums ? false : true,
            data: initializeData(),
            ref: null,
            listener: null,
            interval: null,
        };
        if (props.streamName && props.streamId) {
            let currentData = this.state.data;
            let queue = [];
            const ref = db.ref(`live/${props.streamName}/${props.streamId}`).orderByKey();
            const listener = ref.on("child_added", (snap) => {
                const val = snap.val();
                queue.push(val);
            });
            const interval = setInterval(() => {
                if(queue.length > 0) {
                    const val = queue.shift();
                    currentData = reduceLive({ ...currentData }, val, props.stadiums);
                    this.setState({ data: currentData });
                }
            }, 5);
            this.setState({ ref, listener, interval });
        }
    }
    componentWillUnmount() {
        if (this.state.ref && this.state.listener) {
            this.state.ref.off("child_added", this.state.listener);
        }
        if (this.state.interval) {
            clearInterval(this.state.interval);
        }
    }
    render() {
        const isLoading = this.state.isLoading;
        const hasStream = this.props.streamName && this.props.streamId;
        const d = this.state.data;
        const stadium = d.stadium ? this.props.stadiums[d.stadium] || {} : {};
        const hasStadium = Object.keys(stadium).length > 0;
        const clockLabel = d.isFinal ? "Final" : "Live";
        let problemEl;
        let message;
        if (!hasStream) {
            message = "No stream name/ID provided.";
        } else if (!d.stadium) {
            message = "No stadium provided from match livestream.";
        } else if (!(d.stadium in this.props.stadiums)) {
            message = `Stadium map data not available for: ${d.stadium}`;
        }
        if (message) {
            problemEl = <p>{message}</p>
        }
        return (
            <div key={Date.now()} className={`LiveMain__Container ${isLoading ? "Loading" : ""}`}>
                <div className="Loader">
                    <div class="lds"><div></div><div></div><div></div></div>
                </div>
                <section>
                    <div className="GameBox">
                        <div className="ClockBox">
                            <span className={`BoxIcon ${clockLabel}`}>{clockLabel}</span>
                            <span className="Clock">{toClock(d.time)} {d.isOT ? "OT" : ""}</span>
                        </div>
                        <span>{d.stadium ? d.stadium : "No Stadium"}</span>
                        <div className="ScoreBox">
                            <span className="BoxIcon Red">Red</span>
                            <span className="Score">{d.score.red} - {d.score.blue}</span>
                            <span className="BoxIcon Blue">Blue</span>
                        </div>
                    </div>
                </section>
                { problemEl }
                <div className="CardField" style={{display: hasStadium ? "block" : "none"}}>
                    <h3>Shots on Goal</h3>
                    <Field stadium={stadium} kicks={d.kicks} />
                </div>
                <section>
                    <div className="Halves">
                        <div className="Half">
                            <div class="Card">
                                <h3>Red Offense</h3>
                                <StatsTable table={tableOffense(d.players.red)} />
                            </div>
                        </div>
                        <div className="Half">
                            <div class="Card">
                                <h3>Blue Offense</h3>
                                <StatsTable table={tableOffense(d.players.blue)} />
                            </div>
                        </div>
                    </div>
                    <div className="Halves">
                        <div className="Half">
                            <div class="Card">
                                <h3>Red Defense</h3>
                                <StatsTable table={tableDefense(d.players.red)} />
                            </div>
                        </div>
                        <div className="Half">
                            <div class="Card">
                                <h3>Blue Defense</h3>
                                <StatsTable table={tableDefense(d.players.blue)} />
                            </div>
                        </div>
                    </div>
                </section>
                <div className="CardFake">
                    <p>Processed {plur(d.nEvents, "event")}.</p>
                </div>
            </div>
        );
    }
}

function renderMain(streamName, streamId, stadiums) {
    const mainEl = document.getElementById("main");
    const mainRe = <LiveMain streamName={streamName} streamId={streamId} stadiums={stadiums} />
    ReactDOM.unmountComponentAtNode(mainEl);
    ReactDOM.render(mainRe, mainEl);
}

// This one came before it: live/live/-MQjwDHJP15yYxzlXUOz
// Check this one for wrong victory: live/live/-MQjxK8rB1--Pt54B1ii
// const streamName = "live";
// const streamId = "-MQjk-mRG7Rsko0XBXLc";

const url = document.location.href;
const streamName = getParam(url, "n");
let streamId = getParam(url, "i");

function start(stadiums) {
    if (!streamName) {
        renderMain(null, null, stadiums);
    } else if (streamId) {
        renderMain(streamName, streamId, stadiums);    
    } else {
        db.ref(`live/${streamName}`).orderByKey().limitToLast(1).on("child_added", (snap) => {
            if (snap.key !== streamId) {
                streamId = snap.key;
                renderMain(streamName, streamId, stadiums);
            }
        });    
    }
}

renderMain(null, null, null);
loadStadiumData().then((stadiums) => {
    start(stadiums);
}).catch((err) => {
    console.log("Error loading stadium data:");
    console.error(err);
});
