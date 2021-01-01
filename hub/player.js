const stadiumMap = {
    "NAFL Official Map v1": {
    "stadium": "NAFL Official Map v1",
    "goalposts": {
      "1": {
        "posts": [
          {
            "x": -700,
            "y": -85
          },
          {
            "x": -700,
            "y": 85
          }
        ],
        "size": 170,
        "mid": {
          "x": -700,
          "y": 0
        }
      },
      "2": {
        "posts": [
          {
            "x": 700,
            "y": -85
          },
          {
            "x": 700,
            "y": 85
          }
        ],
        "size": 170,
        "mid": {
          "x": 700,
          "y": 0
        }
      }
    },
    "bounds": {
      "minX": -785,
      "maxX": 785,
      "minY": -335,
      "maxY": 335
    },
    "ball": {
      "radius": 5.8
    }
  }
};

const TEAMS = { 1: "red", 2: "blue", "1": "red", "2": "blue", Red: 1, Blue: 2 };
const PLAYER_RADIUS = 15;
const GOAL_AREA_RADIUS = 1.5;

function calculateField(val) {
    const sizeX = val.bounds.maxX - val.bounds.minX;
    const sizeY = val.bounds.maxY - val.bounds.minY;
    const midX = (sizeX / 2) + val.bounds.minX;
    const midY = (sizeY / 2) + val.bounds.minY;
    const field = { sizeX, sizeY, midX, midY };
    return { ...val, field };
}

function fetchPlayerKicksFromFirebase(playerName) {
    return new Promise((resolveAll, rejectAll) => {
        const fromRef = db.ref("kick").orderByChild("fromName").equalTo(playerName);
        const toRef = db.ref("kick").orderByChild("toName").equalTo(playerName);
        const getQuery = (ref, type) => {
            return new Promise((resolve, reject) => {
                ref.once("value", (snap) => {
                    const kicks = snap.val() || {};
                    resolve({
                        success: true,
                        playerName,
                        type,
                        kicks,
                    });
                }).catch(reject);
            });
        };
        const promises = [
            getQuery(fromRef, "from"),
            getQuery(toRef, "to"),
        ];
        Promise.all(promises).then((results) => {
            const res = results.reduce((agg, val) => {
                const { type, kicks } = val;
                agg["playerName"] = playerName;
                agg[type] = kicks;
                return agg;
            }, {});
            resolveAll(res);
        }).catch(rejectAll);
    });
}

function fetchPlayerKicksFromLocal(playerName) {
    return new Promise((resolveAll, rejectAll) => {
        const getQuery = async (type) => {
            const res = await fetch(`./player_test_data_${type}_kicks.json`);
            const kicks = await res.json();
            return {
                success: true,
                playerName,
                type,
                kicks,
            };
        };
        const promises = [
            getQuery("from"),
            getQuery("to"),
        ];
        Promise.all(promises).then((results) => {
            const res = results.reduce((agg, val) => {
                const { type, kicks } = val;
                agg["playerName"] = playerName;
                agg[type] = kicks;
                return agg;
            }, {});
            resolveAll(res);
        }).catch(rejectAll);
    });
}

function makeArcPath(props) {
    const { x1, y1, x2, y2, sweep } = props;
    const d = `M ${x1} ${y1} A 1 1, 0, 0 ${sweep}, ${x2} ${y2}`;
    return d;
}

function Field(props) {
    const s = props.stadium;
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
                {kicks.filter(k => k.type === "goal").map((kick) => {
                    return (
                        <circle
                            className={`player ${kick.fromTeam}`}
                            cx={toX(kick.fromX)}
                            cy={toY(kick.fromY)}
                            r={PLAYER_RADIUS}
                        />
                    );
                })}
                {kicks.filter(k => k.type === "goal").map((kick) => {
                    const oppGoal = kick.fromTeam === "red" ? gpBlue : gpRed;
                    return (
                        <line
                            className={`shot goal ${kick.fromTeam}`}
                            x1={toX(kick.fromX)}
                            y1={toY(kick.fromY)}
                            x2={toX(oppGoal.mid.x)}
                            y2={toY(oppGoal.mid.y)}
                        />
                    );
                })}
            </svg>
        </div>
    );
}

function PlayerComparison(props) {
    const p = props.player;
    const toPct = (num, den) => {
        const frac = num / den;
        const pct = 100* frac;
        return `${pct.toFixed(1)}%`;
    };
    const plur = (n, s, p) => {
        const ps = p ? p : `${s}s`;
        return n === 1 ? `${n} ${s}` : `${n} ${ps}`;
    }
    return (
        <div className="PlayerComparison">
            <h3>{p.name}</h3>
            <p class="Percentage">
                <span className="Value">{toPct(p.goals, p.shotsTaken)}</span>
                <span className="Label">shot percentage</span>
                <span className="Definition">
                    {plur(p.goals, "goal")} / {plur(p.shotsTaken, "shot")} taken
                </span>
            </p>
            <p class="Percentage">
                <span className="Value">{toPct(p.saves, p.shotsFaced)}</span>
                <span className="Label">save percentage</span>
                <span className="Definition">
                    {plur(p.saves, "save")} / {plur(p.shotsFaced, "shot")} faced
                </span>
            </p>
        </div>
    );
}

function PlayerMain(props) {
    return (
        <div className="PlayerMain__Container">
            <section>
                <h1>Player Analytics</h1>
            </section>
            <section>
                <h2>Player Comparison</h2>
                <div className="PlayerMain__PlayerComparison">
                    {props.players.map((p) => {
                        return (
                            <PlayerComparison player={p} />
                        );
                    })}
                </div>
            </section>
            <section>
                <h2>Field Comparison</h2>
                <Field stadium={props.stadium} kicks={props.kicks} />
            </section>
        </div>
    );
}

// fetchPlayerKicksFromLocal("Vinesh").then((res) => {
//     console.log(res);
// }).catch(console.error);

const stadiumName = "NAFL Official Map v1";
const stadium = calculateField(stadiumMap[stadiumName]);
const data = {
    players: [
        {
            name: "Vinesh",
            goals: 1,
            shotsTaken: 14,
            saves: 7,
            shotsFaced: 16
        },
        {
            name: "pav",
            goals: 6,
            shotsTaken: 26,
            saves: 13,
            shotsFaced: 32
        },
        {
            name: "Vinesh",
            goals: 1,
            shotsTaken: 14,
            saves: 7,
            shotsFaced: 16
        },
        {
            name: "pav",
            goals: 6,
            shotsTaken: 26,
            saves: 13,
            shotsFaced: 32
        }
    ],
    kicks: [
        {
            fromName: "Vinesh",
            fromTeam: "red",
            fromX: 12,
            fromY: 0,
            match: "-MOTVkwbfE_IKa15MVn9",
            saved: 1607903416292,
            scoreBlue: 0,
            scoreLimit: 2,
            scoreRed: 1,
            stadium: "NAFL Official Map v1",
            time: 2.6,
            timeLimit: 180,
            type: "goal"
        },
        {
            fromName: "pav",
            fromTeam: "red",
            fromX: -20,
            fromY: 10,
            match: "-MPc3PR4X1XDNWoCLMZs",
            saved: 1609137498046,
            scoreBlue: 2,
            scoreLimit: 3,
            scoreRed: 0,
            stadium: "NAFL 1v1/2v2 Map v1",
            time: 57.4,
            timeLimit: 180,
            toName: "Vinesh",
            toTeam: "blue",
            toX: 338,
            toY: -136,
            type: "save"
        }
    ]
};

const getMain = () => {
    return (
        <PlayerMain
            players={data.players}
            stadium={stadium}
            kicks={data.kicks}
        />
    );
};
ReactDOM.render(getMain(), document.getElementById("main"));
