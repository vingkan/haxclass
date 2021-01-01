const TEAMS = { 1: "red", 2: "blue", "1": "red", "2": "blue", Red: 1, Blue: 2 };
const PLAYER_RADIUS = 15;
const GOAL_AREA_RADIUS = 1.5;
const LOCAL_DELAY = 0;

// https://coolors.co/59cd90-d90368-3fa7d6-f79d84-ffd400
const PLAYER_COLORS = [
    `217, 3, 104`,
    `63, 167, 214`,
    `255, 212, 0`,
    `89, 205, 144`,
];

let allTimeKickMap = {};

async function loadStadiumData() {
    const stadiumRes = await fetch(`../stadium/map_data.json`).catch(console.error);
    const stadiumDataMap = parseStadiumDataMap(await stadiumRes.json());
    return stadiumDataMap;
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

function fetchPlayerKicksFromFirebase(playerName) {
    return new Promise((resolveAll, rejectAll) => {
        const isCached = playerName in allTimeKickMap;
        if (isCached) {
            console.log(`Using cached data for: ${playerName}.`);
            resolveAll(allTimeKickMap[playerName]);
        } else {
            console.log(`Sending new Firebase query for: ${playerName}.`);
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
                if (combineKicks(res).length === 0) {
                    rejectAll(`No kicks found for player: ${playerName}`);
                } else {
                    resolveAll(res);
                }
            }).catch(rejectAll);            
        }
    });
}

function fetchPlayerKicksFromLocal(playerName) {
    return new Promise((resolveAll, rejectAll) => {
        const getQuery = async (type) => {
            await new Promise((resolve, reject) => {
                setTimeout(resolve, LOCAL_DELAY);
            });
            const res = await fetch(`../mock/player_test_data_kicks_${type}_${playerName}.json`);
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

function getPlayerAnalytics(kickRes) {
    let matchMap = {};
    Object.keys(kickRes.to).forEach((k) => {
        const kick = kickRes.to[k];
        matchMap[kick["match"]] = true;
    });
    Object.keys(kickRes.from).forEach((k) => {
        const kick = kickRes.from[k];
        matchMap[kick["match"]] = true;
    });
    // Shots faced = saves to + errors to.
    const statsTo = Object.keys(kickRes.to).map((k) => {
        return { ...(kickRes.to[k]), id: k };
    }).reduce((agg, kick) => {
        if (kick.type === "save" || kick.type === "error") {
            agg.shotsFaced++;
        }
        if (kick.type === "save") {
            agg.saves++;
        }
        return agg;
    }, {
        saves: 0,
        shotsFaced: 0,
    });
    // Shots taken = goals from + errors from + saves from.
    const statsFrom = Object.keys(kickRes.from).map((k) => {
        return { ...(kickRes.from[k]), id: k };
    }).reduce((agg, kick) => {
        if (kick.type === "goal" || kick.type === "error" || kick.type === "save") {
            agg.shotsTaken++;
        }
        if (kick.type === "goal" || kick.type === "error") {
            agg.goals++;
        }
        return agg;
    }, {
        goals: 0,
        shotsTaken: 0,
    });
    return {
        name: kickRes.playerName,
        matches: Object.keys(matchMap).length,
        ...statsTo,
        ...statsFrom,
    };
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

function PlayerComparison(props) {
    const p = props.player;
    const toPct = (num, den) => {
        if (den > 0) {
            const frac = num / den;
            const pct = 100* frac;
            return `${pct.toFixed(1)}%`; 
        } else {
            return `0.0%`;
        }
    };
    const plur = (n, s, p) => {
        const ps = p ? p : `${s}s`;
        return n === 1 ? `${n} ${s}` : `${n} ${ps}`;
    }
    return (
        <div className={`PlayerComparison ${p.matches > 0 ? "HasData" : "NoData"}`}>
            <span
                className="Remove"
                onClick={(e) => {
                    props.onRemove(props.index);
                }}
            >x</span>
            <h3 style={{color: p.color}}>{p.name}</h3>
            <p>{plur(p.matches, "match", "matches")}</p>
            <p className="Percentage">
                <span className="Value">{toPct(p.goals, p.shotsTaken)}</span>
                <span className="Label">shot percentage</span>
                <span className="Definition">
                    {plur(p.goals, "goal")} / {plur(p.shotsTaken, "shot")} taken
                </span>
            </p>
            <p className="Percentage">
                <span className="Value">{toPct(p.saves, p.shotsFaced)}</span>
                <span className="Label">save percentage</span>
                <span className="Definition">
                    {plur(p.saves, "save")} / {plur(p.shotsFaced, "shot")} faced
                </span>
            </p>
        </div>
    );
}

function PlayerComparisonInput(props) {
    return (
        <div className="PlayerComparison PlayerComparisonInput">
            <h3>Add Player</h3>
            <input
                type="text"
                placeholder="username"
                onKeyPress={async (e) => {
                    if (e.which === 13) {
                        const userEl = e.target;
                        if (userEl.value.length > 0) {
                            props.setLoading(true);
                            await props.onSubmit(userEl.value);
                            userEl.value = "";
                            props.setLoading(false);
                        }
                    }
                }}
            />
            <input
                type="button"
                value="Compare"
                onClick={async (e) => {
                    const userEl = e.target.previousElementSibling;
                    if (userEl.value.length > 0) {
                        props.setLoading(true);
                        await props.onSubmit(userEl.value);
                        userEl.value = "";
                        props.setLoading(false);
                    }
                }}
            />
        </div>
    );
}

function Selector(props) {
    return (
        <div className="Selector">
            <span>{props.label}</span>
            <select onChange={(e) => {
                props.onSelect(e.target.value);
            }}>
                {props.options.map((value) => {
                    const isSelected = value === props.selected;
                    return (
                        <option
                            value={value}
                            selected={isSelected}
                        >{value}</option>
                    );
                })}
            </select>
        </div>
    );
}

function PlayerMain(props) {
    const [loading, setLoading] = React.useState(false);
    const stadium = props.stadium || {};
    return (
        <div className={`PlayerMain__Container ${loading ? "Loading" : ""}`}>
            <div className="Loader">
                <div class="lds"><div></div><div></div><div></div></div>
            </div>
            <section>
                <h1>Player Analytics</h1>
                <Selector
                    label="Stadium:"
                    options={props.stadiumChoices}
                    selected={stadium.stadium}
                    onSelect={props.setStadium}
                />
                <Selector
                    label="Compare Matches:"
                    options={props.comparisonChoices}
                    selected={props.comparisonMode}
                    onSelect={props.setComparisonMode}
                />
            </section>
            <section>
                <h2>Compare Stats</h2>
                <div className="PlayerMain__PlayerComparison">
                    {props.players.map((p, i) => {
                        return (
                            <PlayerComparison
                                key={i}
                                index={i}
                                player={p}
                                onRemove={props.onRemovePlayer}
                            />
                        );
                    })}
                    <PlayerComparisonInput
                        onSubmit={props.onAddPlayer}
                        setLoading={setLoading}
                    />
                </div>
            </section>
            <section>
                <h2>Compare Kicks</h2>
                <Selector
                    label="Show Kicks:"
                    options={props.kickModeChoices}
                    selected={props.kickMode}
                    onSelect={props.setKickMode}
                />
                <div className="KickLegend">
                    <span>Players:</span>
                    {props.players.map((p) => {
                        return (
                            <span style={{color: p.color}}>{p.name}</span>
                        );
                    })}
                </div>
                <Field stadium={props.stadium} kicks={props.kicks} />
            </section>
        </div>
    );
}

function combineKicks(kickRes) {
    let kicks = [];
    Object.keys(kickRes.to).forEach((k) => {
        kicks.push(kickRes.to[k]);
    });
    Object.keys(kickRes.from).forEach((k) => {
        kicks.push(kickRes.from[k]);
    });
    return kicks;
}

function returnEmptyKickRes(playerName) {
    return {
        playerName,
        to: {},
        from: {}
    };
}

function filterKicksByStadium(allKickRes, props) {
    const s = props.stadium || {};
    if (!s.stadium) {
        return {};
    }
    const stadiumName = props.stadium.stadium;
    const filterKicks = (kickMap) => {
        return Object.keys(kickMap).reduce((agg, key) => {
            const kick = kickMap[key];
            if (kick.stadium === stadiumName) {
                agg[key] = kick;
            }
            return agg;
        }, {});
    };
    return props.usernames.reduce((out, username) => {
        const kickRes = allKickRes[username];
        out[username] = {
            playerName: kickRes.playerName,
            to: filterKicks(kickRes.to),
            from: filterKicks(kickRes.from)
        }
        return out;
    }, {});
}

function filterKicksByCommonMatches(inKickRes, props) {
    const allKickRes = filterKicksByStadium(inKickRes, props);
    let matchUserCount = {};
    props.usernames.forEach((username) => {
        const kickRes = allKickRes[username];
        const userMatches = combineKicks(kickRes).reduce((matchMap, kick) => {
            matchMap[kick["match"]] = true;
            return matchMap;
        }, {});
        Object.keys(userMatches).forEach((match) => {
            if (!(match in matchUserCount)) {
                matchUserCount[match] = 0;
            }
            matchUserCount[match]++;
        })
    });
    const filterKicks = (kickMap) => {
        return Object.keys(kickMap).reduce((agg, key) => {
            const kick = kickMap[key];
            const nUsersForMatch = matchUserCount[kick.match];
            const isCommonMatch = nUsersForMatch === props.usernames.length;
            if (isCommonMatch) {
                agg[key] = kick;
            }
            return agg;
        }, {});
    };
    return props.usernames.reduce((out, username) => {
        const kickRes = allKickRes[username];
        out[username] = {
            playerName: kickRes.playerName,
            to: filterKicks(kickRes.to),
            from: filterKicks(kickRes.from)
        }
        return out;
    }, {});
}

function filterKicksByLastN(nMatches) {
    return (inKickRes, props) => {
        const allKickRes = filterKicksByStadium(inKickRes, props);
        const filterKicks = (kickMap, recentMatches) => {
            return Object.keys(kickMap).reduce((agg, key) => {
                const kick = kickMap[key];
                if (kick.match in recentMatches) {
                    agg[key] = kick;
                }
                return agg;
            }, {});
        };
        return props.usernames.reduce((out, username) => {
            const kickRes = allKickRes[username];
            const matchSavedMap = combineKicks(kickRes).reduce((agg, kick) => {
                if (!(kick.match in agg)) {
                    agg[kick.match] = 0;
                }
                if (kick.saved > agg[kick.match]) {
                    agg[kick.match] = kick.saved;
                }
                return agg;
            }, {});
            const recentMatches = Object.keys(matchSavedMap).map((match) => {
                return {
                    match,
                    saved: matchSavedMap[match]
                };
            }).sort((a, b) => {
                return b.saved - a.saved;
            }).filter((m, i) => {
                return i < nMatches;
            }).reduce((agg, val) => {
                agg[val.match] = val.saved;
                return agg;
            }, {});
            out[username] = {
                playerName: kickRes.playerName,
                to: filterKicks(kickRes.to, recentMatches),
                from: filterKicks(kickRes.from, recentMatches)
            }
            return out;
        }, {});
    };
}

function getOpposingGoal(team, stadium) {
    if (!stadium || !stadium.goalposts) {
        return null;
    }
    const hasGoalPosts = stadium.goalposts[TEAMS.Red] && stadium.goalposts[TEAMS.Blue];
    if (!hasGoalPosts) {
        return null;
    }
    return team === "red" ? stadium.goalposts[TEAMS.Blue] : stadium.goalposts[TEAMS.Red];
}

function makeKickOffensive(kick, stadium) {
    const reflectX = kick.fromTeam === "red" ? 1 : -1;
    let res = {
        ...kick,
        fromX: reflectX * kick.fromX,
        fromTeam: "red"
    };
    const oppGoal = getOpposingGoal("red", stadium);
    if (oppGoal) {
        res.toX = oppGoal.mid.x;
        res.toY = oppGoal.mid.y;
    }
    return res;
}

function makeKickDefensive(kick, stadium) {
    const reflectX = kick.toTeam === "red" ? 1 : -1;
    let res = {
        ...kick,
        fromX: reflectX * kick.fromX,
        fromTeam: "blue"
    };
    const oppGoal = getOpposingGoal("blue", stadium);
    if (oppGoal) {
        res["toX"] = oppGoal.mid.x;
        res["toY"] = oppGoal.mid.y;
    }
    return res;
}

function filterKicksForGoalsScored(allKickRes, props) {
    const filterKicks = (kickMap) => {
        return Object.keys(kickMap).reduce((agg, key) => {
            const kick = kickMap[key];
            if (kick.type === "goal" || kick.type === "error") {
                agg[key] = makeKickOffensive(kick, props.stadium);
            }
            return agg;
        }, {});
    };
    return props.usernames.reduce((out, username) => {
        const kickRes = allKickRes[username];
        out[username] = {
            playerName: kickRes.playerName,
            to: {},
            from: filterKicks(kickRes.from)
        }
        return out;
    }, {});
}

function filterKicksForShotsTaken(allKickRes, props) {
    const filterKicks = (kickMap) => {
        return Object.keys(kickMap).reduce((agg, key) => {
            const kick = kickMap[key];
            if (kick.type === "goal" || kick.type === "error" || kick.type === "save") {
                agg[key] = makeKickOffensive(kick, props.stadium);
            }
            return agg;
        }, {});
    };
    return props.usernames.reduce((out, username) => {
        const kickRes = allKickRes[username];
        out[username] = {
            playerName: kickRes.playerName,
            to: {},
            from: filterKicks(kickRes.from)
        }
        return out;
    }, {});
}

function filterKicksForGoalsAllowed(allKickRes, props) {
    const filterKicks = (kickMap) => {
        return Object.keys(kickMap).reduce((agg, key) => {
            const kick = kickMap[key];
            if (kick.type === "error") {
                agg[key] = makeKickDefensive(kick, props.stadium);
            }
            return agg;
        }, {});
    };
    return props.usernames.reduce((out, username) => {
        const kickRes = allKickRes[username];
        out[username] = {
            playerName: kickRes.playerName,
            to: filterKicks(kickRes.to),
            from: {}
        }
        return out;
    }, {});
}

function filterKicksForShotsFaced(allKickRes, props) {
    const filterKicks = (kickMap) => {
        return Object.keys(kickMap).reduce((agg, key) => {
            const kick = kickMap[key];
            if (kick.type === "save" || kick.type === "error") {
                agg[key] = makeKickDefensive(kick, props.stadium);
            }
            return agg;
        }, {});
    };
    return props.usernames.reduce((out, username) => {
        const kickRes = allKickRes[username];
        out[username] = {
            playerName: kickRes.playerName,
            to: filterKicks(kickRes.to),
            from: {}
        }
        return out;
    }, {});
}

const onLocal = document.location.hostname === "localhost"
const forcedProd = document.location.href.indexOf("l=false") > -1;
const isLocal = onLocal && !forcedProd;
const fetchPlayer = isLocal ? fetchPlayerKicksFromLocal : fetchPlayerKicksFromFirebase;
console.log(`Fetching player data from ${isLocal ? "local" : "Firebase"}.`);

const comparisonModes = {
    "All-Time": filterKicksByStadium,
    "Common Matches": filterKicksByCommonMatches,
    "Last 3 Matches": filterKicksByLastN(3),
    "Last 5 Matches": filterKicksByLastN(5),
};

const kickModes = {
    "Goals Scored": filterKicksForGoalsScored,
    "Shots Taken": filterKicksForShotsTaken,
    "Goals Allowed": filterKicksForGoalsAllowed,
    "Shots Faced": filterKicksForShotsFaced,
};

let stadiumDataMap = {};
let comparison = {
    comparisonMode: "All-Time",
    kickMode: "Goals Scored",
    usernames: [],
    stadium: {}
};

const setStadium = async (stadiumName) => {
    if (stadiumName in stadiumDataMap) {
        comparison.stadium = stadiumDataMap[stadiumName];
        renderMain(comparison);
    }    
}

const setComparisonMode = (mode) => {
    if (mode in comparisonModes) {
        comparison.comparisonMode = mode;
        renderMain(comparison);
    }    
}

const setKickMode = (mode) => {
    if (mode in kickModes) {
        comparison.kickMode = mode;
        renderMain(comparison);
    }    
}

const addPlayerToComparison = (username) => {
    return new Promise((resolve, reject) => {
        fetchPlayer(username).then((kickRes) => {
            console.log(`Fetched all-time kicks for ${username}:`);
            console.log(`${Object.keys(kickRes.from).length} from ${username}.`);
            console.log(`${Object.keys(kickRes.to).length} to ${username}.`);
            allTimeKickMap[username] = kickRes;
            comparison.usernames.push(username);
            renderMain(comparison);
            resolve();
        }).catch((err) => {
            const msg = `Failed to find data for player: ${username}`;
            console.log(msg);
            console.error(err);
            alert(msg);
            resolve();
        });
    });
};

const removePlayerFromComparison = (index) => {
    comparison.usernames.splice(index, 1);
    renderMain(comparison);
};

const renderMain = (props) => {
    const stadiumChoices = Object.keys(stadiumDataMap);
    const comparisonModeChoices = Object.keys(comparisonModes);
    const kickModeChoices = Object.keys(kickModes);
    const filterComparisonFn = comparisonModes[props.comparisonMode];
    const filterKicksFn = kickModes[props.kickMode];
    const allComparisonKicks = filterComparisonFn(allTimeKickMap, props);
    const allFilteredKicks = filterKicksFn(allComparisonKicks, props);
    let players = [];
    let kicks = [];
    props.usernames.forEach((username, i) => {
        const defaultKickColor = `rgba(${PLAYER_COLORS[i]}, 0.90)`;
        const comparisonKicks = allComparisonKicks[username] || returnEmptyKickRes(username);
        const playerStats = getPlayerAnalytics(comparisonKicks);
        players.push({
            color: defaultKickColor,
            ...playerStats
        });
        const filteredKicks = allFilteredKicks[username] || returnEmptyKickRes(username);
        let kickCount = 0;
        const kicksToAdd = combineKicks(filteredKicks);
        kicksToAdd.forEach((kick) => {
            kicks.push({
                color: defaultKickColor,
                ...kick
            });
        });
        console.log(`${kicksToAdd.length} kicks for ${username}`);
    });
    const getMain = () => {
        return (
            <PlayerMain
                players={players}
                comparisonMode={props.comparisonMode}
                comparisonChoices={comparisonModeChoices}
                setComparisonMode={setComparisonMode}
                stadium={props.stadium || {}}
                stadiumChoices={stadiumChoices}
                setStadium={setStadium}
                kicks={kicks}
                kickMode={comparison.kickMode}
                kickModeChoices={kickModeChoices}
                setKickMode={setKickMode}
                onAddPlayer={addPlayerToComparison}
                onRemovePlayer={removePlayerFromComparison}
            />
        );
    }
    ReactDOM.render(getMain(), document.getElementById("main"));
};

renderMain(comparison);

loadStadiumData().then((res) => {
    stadiumDataMap = res;
    setStadium("NAFL Official Map v1");
}).catch(console.error);

if (isLocal) {
    const setUpLocal = async () => {
        await addPlayerToComparison("pav");
        await addPlayerToComparison("Vinesh");
        await setKickMode("Shots Taken");
    }
    setUpLocal();
}
