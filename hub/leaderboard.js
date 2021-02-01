const url = document.location.href;
const isLocal = document.location.hostname === "localhost" && document.location.href.indexOf("l=false") == -1;
const useLocalML = isLocal || getParam(url, "localml");
const HAXML_SERVER = useLocalML ? "http://localhost:5000" : "https://haxml.herokuapp.com";
const useRecent = getParam(url, "recent");
let nRecent = 50;
if (!isNaN(parseInt(useRecent))) {
    nRecent = Math.max(parseInt(useRecent), 1);
}
console.log(`Fetching summaries from ${isLocal ? "mock data" : "Firebase"}.`);
console.log(`Fetching predictions from ${useLocalML ? "local server" : "Heroku"}.`);
console.log(`Fetching ranks for ${useRecent ? nRecent + " recent matches" : "current matches"}.`);

const INITIAL_ELO = 1500;
const PURPLE_RGB = `103,102,253`;

// Source: https://gist.github.com/mucar/3898821
const RANDOM_COLORS = [
    "#FF6633", "#FFB399", "#FF33FF", "#FFFF99", "#00B3E6", 
    "#E6B333", "#3366E6", "#999966", "#99FF99", "#B34D4D",
    "#80B300", "#809900", "#E6B3B3", "#6680B3", "#66991A", 
    "#FF99E6", "#CCFF1A", "#FF1A66", "#E6331A", "#33FFCC",
    "#66994D", "#B366CC", "#4D8000", "#B33300", "#CC80CC", 
    "#66664D", "#991AFF", "#E666FF", "#4DB3FF", "#1AB399",
    "#E666B3", "#33991A", "#CC9999", "#B3B31A", "#00E680", 
    "#4D8066", "#809980", "#E6FF80", "#1AFF33", "#999933",
    "#FF3380", "#CCCC00", "#66E64D", "#4D80CC", "#9900B3", 
    "#E64D66", "#4DB380", "#FF4D4D", "#99E6E6", "#6666FF"
];

Chart.defaults.global.defaultFontColor = "white";
Chart.defaults.global.defaultFont = "Roboto";

/* Data Fetchers */

let RECENCY_MODE = "last 6 hours";

function fetchRecentSummariesFromFirebase(since, callbackFn) {
    const summaryRef = db.ref("summary").orderByChild("saved").startAt(since);
    const staticRef = db.ref("summary").orderByChild("saved").limitToLast(nRecent);
    summaryRef.once("value", (checkSnap) => {
        const checkVal = checkSnap.val();
        if (!checkVal || useRecent) {
            // Falling back to static data.
            staticRef.once("value", (staticSnap) => {
                const staticVal = staticSnap.val();
                RECENCY_MODE = `last ${nRecent} saved`;
                callbackFn(staticVal);
            });
        } else {
            RECENCY_MODE = "last 6 hours";
            callbackFn(checkVal);
        }
        // Still listening for live data.
        if (!useRecent) {
            summaryRef.on("value", (snap) => {
                const val = snap.val();
                if (val) {
                    RECENCY_MODE = "last 6 hours";
                    callbackFn(val);   
                }
            });
        }
    });
}

function fetchRecentSummariesFromLocal(since, callbackFn) {
    fetch("../mock/leaderboard_recent_summaries.json").then(async (done) => {
        const res = await done.json();
        callbackFn(res);
    });
}

/* XG Data */

function XGAccessor() {
    let isStarted = false;
    let progress = { requested: 0, completed: 0 };
    let matches = {};
    let requestedMatches = [];
    let progressCallback;
    let matchesCallback;
    const requestMatchXG = (mid) => {
        if (isStarted) {
            if (!(mid in matches)) {
                progress.requested++;
                if (progressCallback) {
                    progressCallback(progress);
                }
                fetch(`${HAXML_SERVER}/xg/${mid}`).then(async (res) => {
                    const xgData = await res.json();
                    matches[mid] = xgData;
                    progress.completed++;
                    if (progressCallback) {
                        progressCallback(progress);
                    }
                    if (matchesCallback) {
                        matchesCallback(matches);
                    }
                    if (!xgData.success) {
                        console.log(xgData);
                    }
                }).catch((err) => {
                    console.log(`Error getting XG for match ID : ${mid}`);
                    console.error(err);
                });
            }
        } else {
            requestedMatches.push(mid);
        }
    };
    let accessor = {
        start: () => {
            if (!isStarted) {
                fetch(`${HAXML_SERVER}/hello`).then(async (done) => {
                    const res = await done.text();
                    isStarted = true;
                    requestedMatches.forEach((mid) => {
                        requestMatchXG(mid);
                    });
                    requestedMatches = [];
                }).catch((err) => {
                    console.log("Error connecting to HaxML server:");
                    console.error(err);
                });
            }
        },
        request: (mid) => {
            requestMatchXG(mid);
        },
        getProgress: () => {
            return progress;
        },
        getMatches: () => {
            return matches;
        },
        onProgress: (callbackFn) => {
            progressCallback = callbackFn;
        },
        onMatches: (callbackFn) => {
            matchesCallback = callbackFn;
        },
        hasData: () => {
            return progress.completed > 0;
        }
    };
    return accessor;
}

/* ELO Ratings */

function getELOForTeamAverage(eloScores) {
    if (eloScores.length > 0) {
        return eloScores.reduce((agg, val) => agg + val, 0) / eloScores.length;
    }
    return 0;
}

function getELOForTeamSum(eloScores) {
    if (eloScores.length > 0) {
        return eloScores.reduce((agg, val) => agg + val, 0);
    }
    return 0;
}

function getELOWinProbability(ourELO, oppELO, d=400) {
    const validScores = !(isNaN(ourELO) || isNaN(oppELO));
    const validSpread = d > 0;
    if (validScores && validSpread) {
        const exp = (oppELO - ourELO) / d;
        const prob = 1 / (1 + Math.pow(10, exp));
        return prob;
    }
    return 0.5;
}

function getELOForMatchBinary(eloA, eloB, wonByA, k=40, d=400) {
    const winProbA = getELOWinProbability(eloA, eloB, d);
    const expectedScore = winProbA;
    const actualScore = wonByA ? 1 : 0;
    const eloChange = k * (actualScore - expectedScore);
    return Math.abs(eloChange);
}

function getELOForMatchGoals(eloA, eloB, goalDiffA, k=40, d=400) {
    const winProbA = getELOWinProbability(eloA, eloB, d);
    const expectedScore = winProbA;
    const actualScore = goalDiffA > 0 ? 1 : 0;
    const eloChange = k * Math.abs(goalDiffA) * (actualScore - expectedScore);
    return Math.abs(eloChange);
}

function ranksFromSummaries(rawSummaries, eloParams) {
    const summaries = rawSummaries ? rawSummaries : [];
    let rankedMatches = [];
    let ratingHistory = [];
    const playerRankMap = summaries.reduce((playerMap, s) => {
        // Skip matches that don't split players by team.
        const hasPlayersByTeam = s.playersRed || s.playersBlue;
        if (!hasPlayersByTeam) {
            return playerMap;
        }
        // Extract name, team, and outcome for each player.
        const wonByRed = s.scoreRed > s.scoreBlue;
        const goalDiffRed = s.scoreRed - s.scoreBlue;
        const parseTeam = (rawNames, team) => {
            const won = team === "red" ? wonByRed : !wonByRed;
            const goalDiff = team === "red" ? goalDiffRed : -1 * goalDiffRed;
            const names = rawNames ? rawNames.split(", ") : [];
            return names.map((name) => {
                return {
                    name,
                    team,
                    won,
                    goalDiff,
                };
            });
        };
        const playersRed = parseTeam(s.playersRed, "red");
        const playersBlue = parseTeam(s.playersBlue, "blue");
        const allPlayers = [ ...playersRed, ...playersBlue ];
        // Add initial player entries to player map.
        allPlayers.forEach((record) => {
            const { name, team, won } = record;
            if (!(name in playerMap)) {
                playerMap[name] = {
                    name,
                    wins: 0,
                    losses: 0,
                    goalDiff: 0,
                    eloRating: INITIAL_ELO,
                    eloHistory: [ ...ratingHistory, INITIAL_ELO ],
                    winningStreak: false,
                    streakSize: 0,
                };
            }
        });
        const getPlayerELO = ({ name }) => {
            return playerMap[name].eloRating;
        };
        const { k, d, mode, method } = eloParams;
        // Default to average score.
        let getELOForTeam = getELOForTeamAverage;
        if (method === "average") {
            getELOForTeam = getELOForTeamAverage;
        } else if (method === "sum") {
            getELOForTeam = getELOForTeamSum;
        }
        const eloRed = getELOForTeam(playersRed.map(getPlayerELO));
        const eloBlue = getELOForTeam(playersBlue.map(getPlayerELO));
        // Default to binary ELO scoring.
        let eloMatch;
        if (mode === "binary") {
            eloMatch = getELOForMatchBinary(eloRed, eloBlue, wonByRed, k, d);
        } else if (mode === "goals") {
            eloMatch = getELOForMatchGoals(eloRed, eloBlue, goalDiffRed, k, d);
        } else {
            eloMatch = getELOForMatchBinary(eloRed, eloBlue, wonByRed, k, d);
        }
        const winProbRed = getELOWinProbability(eloRed, eloBlue, d);
        // Add match data to ranked matches list.
        const rankedMatch = {
            ...s,
            playersRed,
            playersBlue,
            eloRed,
            eloBlue,
            winProbRed,
            winProbBlue: 1 - winProbRed,
            eloMatch,
        };
        rankedMatches.push(rankedMatch);
        // Update entries for players in the match.
        let updatedPlayers = {};
        allPlayers.forEach((record) => {
            const { name, team, won, goalDiff } = record;
            const lastELO = playerMap[name].eloRating;
            let nextELO = lastELO;
            if (won) {
                playerMap[name].wins++;
                nextELO = lastELO + eloMatch;
            } else {
                playerMap[name].losses++;
                nextELO = lastELO - eloMatch;
            }
            playerMap[name].eloRating = nextELO;
            playerMap[name].eloHistory.push(nextELO);
            playerMap[name].goalDiff += goalDiff;
            updatedPlayers[name] = true;
            const { winningStreak, streakSize } = playerMap[name];
            // For the player's first match, streakSize will be 0.
            if (streakSize === 0) {
                if (won) {
                    playerMap[name].winningStreak = true;
                    playerMap[name].streakSize = 1;    
                } else {
                    playerMap[name].winningStreak = false;
                    playerMap[name].streakSize = 1;
                }
            } else {
                const streakContinues = winningStreak === won;
                if (streakContinues) {
                    playerMap[name].streakSize++;
                } else {
                    playerMap[name].winningStreak = won;
                    playerMap[name].streakSize = 1;
                }
            }
        });
        // Update entries for players NOT in the match.
        Object.keys(playerMap).forEach((name) => {
            if (!(name in updatedPlayers)) {
                const currentELO = playerMap[name].eloRating
                playerMap[name].eloHistory.push(currentELO);
            }
        });
        ratingHistory.push(null);
        return playerMap;
    }, {});
    const rankedPlayers = toList(playerRankMap).sort((a, b) => {
        return b.eloRating - a.eloRating;
    }).map((p, i) => {
        return {
            ...p,
            rank: i + 1,
        }
    });
    return { rankedPlayers, rankedMatches };
}

const defaultPlayerRecord = () => {
    return {
        matches: {},
        totalGoals: 0,
        totalXG: 0,
        totalSaves: 0,
        totalAssists: 0,
        matchesGK: 0,
        goalsAllowed: 0,
        xgFaced: 0,
        sumPos: 0,
        posOff: 0,
        posDef: 0,
        nPos: 0,
    };
};

const defaultMatchRecord = () => {
    return {
        xgRed: 0,
        xgBlue: 0,
    }
};

function statsFromXG(xgMap) {
    let xgPlayers = {};
    let xgMatches = {};
    toList(xgMap).forEach(({ success, mid, match }) => {
        if (!success) return;
        match.goals.forEach((g) => {
            const assistName = g.assistName;
            if (!assistName) return;
            if (!(assistName in xgPlayers)) {
                xgPlayers[assistName] = defaultPlayerRecord();
            }
            xgPlayers[assistName].matches[mid] = true;
            if (assistName) {
                xgPlayers[assistName].totalAssists++;
            }
        });
        let teamXG = { "red": 0, "blue": 0 };
        match.kicks.forEach((k) => {
            const fromName = k.fromName;
            const toName = k.toName;
            if (!(fromName in xgPlayers)) {
                xgPlayers[fromName] = defaultPlayerRecord();
            }
            if (!(toName in xgPlayers)) {
                xgPlayers[toName] = defaultPlayerRecord();
            }
            xgPlayers[fromName].matches[mid] = true;
            xgPlayers[toName].matches[mid] = true;
            xgPlayers[fromName].totalXG += k.xg;
            teamXG[k.fromTeam] += k.xg;
            if (k.type === "goal" || k.type === "error") {
                xgPlayers[fromName].totalGoals++;
            }
            if (k.type === "save") {
                xgPlayers[toName].totalSaves++;
            }
        });
        let posMap = {};
        match.positions.forEach((p) => {
            if (p.type === "player") {
                // Count positions for each player.
                const name = p.name;
                if (!(name in xgPlayers)) {
                    xgPlayers[name] = defaultPlayerRecord();
                }
                xgPlayers[name].matches[mid] = true;
                // Count positions for each match.
                if (!(name in posMap)) {
                    posMap[name] = {
                        name: name,
                        team: p.team,
                        sumPos: 0,
                        nPos: 0,
                    };
                }
                // Mirror positions so defense has negative X and offense has positive X.
                const pos = p.team === "red" ? p.x : -1 * p.x;
                if (pos <= 0) {
                    xgPlayers[name].posDef++;
                } else {
                    xgPlayers[name].posOff++;
                }
                xgPlayers[name].sumPos += pos;
                xgPlayers[name].nPos++;
                posMap[name].sumPos += pos;
                posMap[name].nPos++;
            }
        });
        const getGK = (matchPosMap, team) => {
            let lowestPos = Infinity;
            let gkName = null;
            toList(matchPosMap).forEach((p) => {
                if (p.team !== team) return;
                if (p.sumPos < lowestPos) {
                    lowestPos = p.sumPos;
                    gkName = p.name;
                }
            });
            return gkName;
        }
        const redGK = getGK(posMap, "red");
        const blueGK = getGK(posMap, "blue");
        if (!(redGK in xgPlayers)) {
            xgPlayers[redGK].matches[mid] = true;
        }
        if (!(blueGK in xgPlayers)) {
            xgPlayers[blueGK].matches[mid] = true;
        }
        xgPlayers[redGK].matchesGK++;
        xgPlayers[blueGK].matchesGK++;
        xgPlayers[redGK].goalsAllowed += match.score.blue;
        xgPlayers[blueGK].goalsAllowed += match.score.red;
        xgPlayers[redGK].xgFaced += teamXG.blue;
        xgPlayers[blueGK].xgFaced += teamXG.red;
        xgMatches[mid] = defaultMatchRecord();
        xgMatches[mid].xgRed = teamXG.red;
        xgMatches[mid].xgBlue = teamXG.blue;
    });
    return { xgPlayers, xgMatches };
}

function styleProb(prob, rgb=FUTSAL_RGB) {
    return {
        background: `rgba(${rgb}, ${prob})`,
    };
}

function styleELO(elo, mi=1100, ma=1900) {
    return {
        background: `rgba(${FUTSAL_RGB}, ${getAlpha(elo, mi, ma)})`,
    };
}

function styleNoWrap(style={}) {
    return {
        ...style,
        "white-space": "nowrap",
    }
}

function styleWinner(winner, team) {
    if (winner === team) {
        return {
            background: `rgba(${TEAM_RGB[team.toLowerCase()]}, 0.5)`,
        };
    }
    return {};
}

function tableRankedPlayers(rankedPlayers) {
    const headers = [
        { key: "rank", name: "#" },
        { key: "eloRating", name: "ELO", style: (r) => styleELO(r.eloRating) },
        { key: "name", name: "Player" },
        { key: "matches", name: "N", desc: "Matches Played" },
        { key: "wins", name: "W", desc: "Wins" },
        { key: "losses", name: "L", desc: "Losses" },
        { key: "winRate", name: "Win%", style: (r) => styleProb(r.winRate) },
        { key: "goalDiff", name: "Diff", desc: "Goal Differential" },
        { key: "streak", name: "Streak" },
    ];
    const rows = rankedPlayers.map((p, i) => {
        const diff = p.goalDiff;
        const streakAbbr = `${p.winningStreak ? "W" : "L"}${p.streakSize}`;
        return {
            rank: p.rank,
            name: p.name,
            matches: p.wins + p.losses,
            wins: p.wins,
            losses: p.losses,
            winRate: (p.wins / (p.wins + p.losses)).toFixed(2),
            elo: p.eloRating,
            eloRating: (p.eloRating).toFixed(0),
            goalDiff: diff > 0 ? `+${diff}` : diff,
            streak: streakAbbr,
        };
    });
    return { headers, rows };
}

function tableRankedPlayersWithXG(xgPlayers) {
    return (rankedPlayers) => {
        const playerTable = tableRankedPlayers(rankedPlayers);
        const headers = [
            ...playerTable.headers,
            { key: "role", name: "Role" },
            { key: "goals", name: "G", desc: "Total Goals Scored" },
            { key: "assists", name: "A", desc: "Total Assists" },
            { key: "saves", name: "S", desc: "Total Saves" },
            { key: "matchesGK", name: "GK", desc: "Matches as GK" },
            {
                key: "avgGoals",
                name: "GpG",
                desc: "Goals Scored per Game",
                style: (r) => styleProb(r.avgGoals, TEAM_RGB.red)
            },
            {
                key: "avgXG",
                name: "XGpG",
                desc: "Expected Goals Scored per Game",
                style: (r) => styleProb(r.avgXG, TEAM_RGB.red)
            },
            // {
            //     key: "avgSaves",
            //     name: "SpG",
            //     desc: "Saves per Game",
            //     style: (r) => styleProb(r.avgSaves)
            // },
            {
                key: "avgGAShow",
                name: "GApG",
                desc: "Goals Allowed per Game",
                style: (r) => styleProb(r.avgGAAlpha, TEAM_RGB.blue)
            },
            {
                key: "avgXGAShow",
                name: "XGApG",
                desc: "Expected Goals Allowed per Game",
                style: (r) => styleProb(r.avgXGAAlpha, TEAM_RGB.blue)
            },
            {
                key: "fracOff",
                name: "Off%",
                desc: "% Time on Offense",
                style: (r) => styleProb(r.fracOff, PURPLE_RGB)
            },
        ];
        const rows = playerTable.rows.map((row) => {
            const p = xgPlayers[row.name] || defaultPlayerRecord();
            const n = Object.keys(p.matches).length;
            const fracOff = div(p.posOff, p.nPos, 2);
            const fracGK = div(p.matchesGK, n, 2);
            const hasGK = p.matchesGK > 0;
            const avgGA = div(p.goalsAllowed, p.matchesGK, 2);
            const avgXGA = div(p.xgFaced, p.matchesGK, 2);
            let role;
            if (fracOff > 0.5) {
                role = "FWD";
            } else if (fracOff > 0.35) {
                role = "MID";
            } else if (fracGK > 0.333) {
                role = "GK";
            } else {
                role = "DEF";
            }
            const alphaGA = (ga) => {
                return 1 - (Math.min(ga, 3) / 3);
            };
            return {
                ...row,
                xgn: n,
                goals: p.totalGoals,
                assists: p.totalAssists,
                avgGoals: div(p.totalGoals, n, 2),
                avgXG: div(p.totalXG, n, 2),
                saves: p.totalSaves,
                avgSaves: div(p.totalSaves, n, 2),
                hasGK: hasGK,
                matchesGK: p.matchesGK,
                avgGA: avgGA,
                avgXGA: avgXGA,
                avgGAAlpha: hasGK ? alphaGA(avgGA) : 0,
                avgXGAAlpha: hasGK ? alphaGA(avgXGA) : 0,
                avgGAShow: hasGK ? avgGA : "N/A",
                avgXGAShow: hasGK ? avgXGA : "N/A",
                fracOff: fracOff,
                role: role,
            };
        });
        return { headers, rows };
    }
}

function tableRankedMatches(rankedMatches) {
    const headers = [
        { key: "index", name: "#" },
        { key: "saved", name: "Time", style: (r) => styleNoWrap() },
        { key: "winner", name: "Winner", style: (r) => styleWinner(r.winner, r.winner) },
        { key: "duration", name: "Duration" },
        { key: "winProb", name: "Win Prob", style: (r) => styleProb(r.winProb) },
        { key: "finalScore", name: "Final Score" },
        {
            key: "eloDelta",
            name: "ΔELO",
            desc: "Change in Player ELO Ratings from Match",
            style: (r) => styleELO(r.eloMatch, 25, 175)
        },
        { key: "teamRed", name: "Red Team", style: (r) => styleWinner(r.winner, "Red") },
        { key: "eloRatingRed", name: "ELO", style: (r) => styleELO(r.eloRed) },
        { key: "teamBlue", name: "Blue Team", style: (r) => styleWinner(r.winner, "Blue") },
        { key: "eloRatingBlue", name: "ELO", style: (r) => styleELO(r.eloBlue) },
    ];
    const rows = rankedMatches.sort((a, b) => {
        return b.saved - a.saved;
    }).map((m, i) => {
        const redWon = m.scoreRed > m.scoreBlue;
        const winProb = redWon ? m.winProbRed : m.winProbBlue;
        return {
            id: m.id,
            "index": rankedMatches.length - i,
            saved: formatMatchTimeOnlyString(m.saved),
            duration: toClock(m.time),
            winner: redWon ? "Red" : "Blue",
            winProb: winProb.toFixed(3),
            finalScore: `${m.scoreRed} - ${m.scoreBlue}`,
            eloMatch: m.eloMatch,
            eloDelta: m.eloMatch.toFixed(0),
            teamRed: m.playersRed.map(p => p.name).join(", "),
            eloRed: m.eloRed,
            eloRatingRed: m.eloRed.toFixed(0),
            teamBlue: m.playersBlue.map(p => p.name).join(", "),
            eloBlue: m.eloBlue,
            eloRatingBlue: m.eloBlue.toFixed(0),
        };
    });
    return { headers, rows };
}

function tableRankedMatchesWithXG(xgMatches) {
    return (rankedMatches) => {
        const matchTable = tableRankedMatches(rankedMatches);
        const nOrigCols = matchTable.headers.length;
        const headers = [
            ...matchTable.headers.slice(0, nOrigCols - 2),
            {
                key: "xgRed",
                name: "XG",
                desc: "Red Team Expected Goals Scored",
                style: (r) => styleProb(r.xgRedAlpha, TEAM_RGB.red)

            },
            ...matchTable.headers.slice(nOrigCols - 2, nOrigCols),
            {
                key: "xgBlue",
                name: "XG",
                desc: "Blue Team Expected Goals Scored",
                style: (r) => styleProb(r.xgBlueAlpha, TEAM_RGB.blue)

            },
        ];
        const rows = matchTable.rows.map((row) => {
            const hasXG = row.id in xgMatches;
            const m = xgMatches[row.id] || defaultMatchRecord();
            const alphaXG = (xg) => {
                return Math.min(xg, 3) / 3;
            };
            return {
                ...row,
                xgRedAlpha: alphaXG(m.xgRed),
                xgBlueAlpha: alphaXG(m.xgBlue),
                xgRed: hasXG ? m.xgRed.toFixed(2) : "N/A",
                xgBlue: hasXG ? m.xgBlue.toFixed(2) : "N/A",
            };
        });
        return { headers, rows };
    }
}

class ELOChart extends React.Component {
    constructor (props) {
        super(props);
        this.ref = React.createRef();
    }
    componentDidMount() {
        const el = this.ref.current;
        const canvasEl = el.querySelector("canvas");
        const rankedPlayers = this.props.rankedPlayers;
        if (rankedPlayers.length === 0) {
            return;
        }
        const labels = rankedPlayers[0].eloHistory.map((p, i) => i);
        const config = {
            type: "line",
            data: {
                labels,
                datasets: rankedPlayers.map((p, i) => {
                    const seriesColor = RANDOM_COLORS[i % RANDOM_COLORS.length];
                    return {
                        label: p.name,
                        fill: false,
                        borderColor: seriesColor,
                        backgroundColor: seriesColor,
                        data: p.eloHistory.map(d => d ? d.toFixed(0) : d),
                        hidden: i >= 10,
                    };
                }),
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                tooltips: {
                    mode: "index",
                    intersect: false,
                },
                hover: {
                    mode: "nearest",
                    intersect: false
                },
                legend: {
                    position: "bottom",
                    align: "start"
                },
                scales: {
                    xAxes: [{
                        display: true,
                        scaleLabel: {
                            display: true,
                            labelString: "Match"
                        },
                        gridLines: {
                            display: true,
                            lineWidth: 0.5,
                            color: "rgba(255, 255, 255, 0.25)"
                        }
                    }],
                    yAxes: [{
                        display: true,
                        scaleLabel: {
                            display: true,
                            labelString: "ELO Rating"
                        },
                        gridLines: {
                            display: true,
                            lineWidth: 0.5,
                            color: "rgba(255, 255, 255, 0.25)"
                        }
                    }]
                }
            }
        };
        const ctx = canvasEl.getContext("2d");
        const chart = new Chart(ctx, config);
        this.chart = chart;
        const toggleBtn = el.querySelector("button");
        let isHidden = true;
        toggleBtn.addEventListener("click", (e) => {
            isHidden = !isHidden;
            chart.data.datasets.forEach((series) => {
                series.hidden = isHidden;
            });
            chart.update();
            toggleBtn.innerText = isHidden ? "Show All" : "Hide All";
        });
    }
    componentWillUnmount() {
        if (this.chart) {
            this.chart.destroy();
        }
    }
    render() {
        const nPlayers = this.props.rankedPlayers.length;
        const height = nPlayers > 50 ? (400 + (3 * nPlayers)) : 400;
        return (
            <div className="ELOChart" ref={this.ref}>
                <canvas height={height}></canvas>
                <button className="Btn__Small ELOChart__Toggle">Show All</button>
            </div>
        );
    }
}

function LeaderboardMain(props) {
    // Set component hooks.
    const eloParams = { k: 100, d: 400, mode: "binary", method: "average" };
    const xgAccessor = props.xgAccessor;
    const [ isLoading, setIsLoading ] = React.useState(false);
    const [ xgProgress, setXGProgress ] = React.useState(xgAccessor.getProgress());
    const initialXGStats = statsFromXG(xgAccessor.getMatches());
    const [ xgStats, setXGStats ] = React.useState(initialXGStats);
    const { xgPlayers, xgMatches } = xgStats;
    // Set XG data listeners.
    xgAccessor.onProgress((progress) => {
        setXGProgress(progress);
    });
    xgAccessor.onMatches((matches) => {
        setXGStats(statsFromXG(matches));
    });
    // Compute data for view.
    const { rankedPlayers, rankedMatches}  = ranksFromSummaries(props.summaries, eloParams);
    const nRankedMatches = plur(rankedMatches.length, "match", "matches");
    const xgRequested = plur(xgProgress.requested, "match", "matches");
    const tablePlayers = xgAccessor.hasData() ? tableRankedPlayersWithXG(xgPlayers) : tableRankedPlayers;
    const tableMatches = xgAccessor.hasData() ? tableRankedMatchesWithXG(xgMatches) : tableRankedMatches;
    return (
        <div className={`MainContainer Leaderboard ${isLoading ? "Loading" : ""}`}>
            <div className="Loader">
                <div class="lds"><div></div><div></div><div></div></div>
            </div>
            <section>
                <h1>Leaderboard</h1>
                <p>
                    <span>Rankings based on <span className="Bold">{nRankedMatches}</span></span>
                    <span> of <span className="Bold">{props.stadiumFilter.name}</span></span>
                    <span> over the <span className="Bold">{RECENCY_MODE}</span>.</span>
                </p>
                <h3>ELO Ratings Over Time</h3>
                <ELOChart
                    rankedPlayers={rankedPlayers}
                />
                <p style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>
                        <button
                            className="Btn__Small"
                            onClick={(e) => {
                                xgAccessor.start();
                            }}
                        >Show Extended Stats</button>
                    </span>
                    <span>
                        <span>Loaded extended stats for</span>
                        <span> <span className="Bold">{xgProgress.completed}</span></span>
                        <span> / <span className="Bold">{xgRequested}</span>.</span>
                    </span>
                </p>
                <StatsTable
                    table={tablePlayers(rankedPlayers)}
                    title={"Ranked Players"}
                    isSearchable={true}
                    hasMultiTermSearch={true}
                    searchWidth={400}
                />
                <br />
                <StatsTable
                    table={tableMatches(rankedMatches)}
                    title={"Ranked Matches"}
                    isSearchable={true}
                    hasMultiTermSearch={true}
                    searchWidth={400}
                />
            </section>
        </div>
    );
}

const HOUR_MS = 60 * 60 * 1000;
const nowTime = isLocal ? new Date("1/17/2021 2:00 PM").getTime() : Date.now();
const fromTime = nowTime - (6 * HOUR_MS);
const fetchSummaries = isLocal ? fetchRecentSummariesFromLocal : fetchRecentSummariesFromFirebase;
const startExtended = getParam(url, "x");
const xgAccessor = XGAccessor();
const stadiumFilter = {
    name: "Futsal (3v3 and 4v4)",
    stadiums: {
        "NAFL Official Map v1": true,
        "FUTHAX 4v4": true,
        "Futsal x3": true,
        "WFL - 4v4": true,
    }
};

function renderMain(summaries) {
    const mainEl = document.getElementById("main");
    const mainRe = (
        <LeaderboardMain
            summaries={summaries}
            xgAccessor={xgAccessor}
            stadiumFilter={stadiumFilter}
        />
    );
    ReactDOM.unmountComponentAtNode(mainEl);
    ReactDOM.render(mainRe, mainEl);
}

if (startExtended) {
    xgAccessor.start();
}
renderMain(null);
fetchSummaries(fromTime, (val) => {
    if (val) {
        const summaries = toList(val).filter((s) => {
            return s.stadium in stadiumFilter.stadiums;
        }).sort((a, b) => {
            return a.saved - b.saved;
        });
        renderMain(summaries);
        summaries.forEach((s) => {
            xgAccessor.request(s.id);
        });
    }
});
