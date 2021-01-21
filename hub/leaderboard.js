const isLocal = document.location.hostname === "localhost" && document.location.href.indexOf("l=false") == -1;
const HAXML_SERVER = isLocal ? "http://localhost:5000" : "https://haxml.herokuapp.com";

const INITIAL_ELO = 1500;

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

function styleProb(prob) {
    return {
        background: `rgba(${FUTSAL_RGB}, ${prob})`,
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
        { key: "matches", name: "N" },
        { key: "wins", name: "W" },
        { key: "losses", name: "L" },
        { key: "winRate", name: "Win %", style: (r) => styleProb(r.winRate) },
        { key: "goalDiff", name: "Goal Diff" },
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
            winRate: (p.wins / (p.wins + p.losses)).toFixed(3),
            elo: p.eloRating,
            eloRating: (p.eloRating).toFixed(0),
            goalDiff: diff > 0 ? `+${diff}` : diff,
            streak: streakAbbr,
        };
    });
    return { headers, rows };
}

function tableRankedMatches(rankedMatches) {
    const headers = [
        { key: "index", name: "#" },
        { key: "saved", name: "Time", style: (r) => styleNoWrap() },
        { key: "winner", name: "Winner", style: (r) => styleWinner(r.winner, r.winner) },
        { key: "duration", name: "Duration" },
        { key: "winProb", name: "Win Prob", style: (r) => styleProb(r.winProb) },
        { key: "finalScore", name: "Final Score" },
        { key: "eloDelta", name: "ΔELO", style: (r) => styleELO(r.eloMatch, 25, 175) },
        { key: "teamRed", name: "Red Team", style: (r) => styleWinner(r.winner, "Red") },
        { key: "eloRatingRed", name: "Red ELO", style: (r) => styleELO(r.eloRed) },
        { key: "teamBlue", name: "Blue Team", style: (r) => styleWinner(r.winner, "Blue") },
        { key: "eloRatingBlue", name: "Blue ELO", style: (r) => styleELO(r.eloBlue) },
    ];
    const rows = rankedMatches.sort((a, b) => {
        return b.saved - a.saved;
    }).map((m, i) => {
        const redWon = m.scoreRed > m.scoreBlue;
        const winProb = redWon ? m.winProbRed : m.winProbBlue;
        return {
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
        return (
            <div className="ELOChart" ref={this.ref}>
                <canvas></canvas>
                <button className="ELOChart__Toggle">Show All</button>
            </div>
        );
    }
}

function LeaderboardMain(props) {
    const [ isLoading, setIsLoading ] = React.useState(false);
    const eloParams = { k: 100, d: 400, mode: "goals", method: "average" };
    const { rankedPlayers, rankedMatches}  = ranksFromSummaries(props.summaries, eloParams);
    const nRankedMatches = plur(rankedMatches.length, "match", "matches");
    return (
        <div className={`MainContainer Leaderboard ${isLoading ? "Loading" : ""}`}>
            <div className="Loader">
                <div class="lds"><div></div><div></div><div></div></div>
            </div>
            <section>
                <h1>Leaderboard</h1>
                <p>
                    <span>Rankings based on <span className="Bold">{nRankedMatches}</span></span>
                    <span> on <span className="Bold">{props.stadium}</span></span>
                    <span> over the <span className="Bold">last 6 hours</span>.</span>
                </p>
                <h3>ELO Ratings Over Time</h3>
                <ELOChart
                    rankedPlayers={rankedPlayers}
                />
                <br />
                <StatsTable
                    table={tableRankedPlayers(rankedPlayers)}
                    title={"Ranked Players"}
                    isSearchable={true}
                />
                <br />
                <StatsTable
                    table={tableRankedMatches(rankedMatches)}
                    title={"Ranked Matches"}
                    isSearchable={true}
                />
            </section>
        </div>
    );
}

const HOUR_MS = 60 * 60 * 1000
const fromTime = Date.now() - (6 * HOUR_MS);
const STADIUM = "NAFL Official Map v1";

function renderMain(summaries) {
    const mainEl = document.getElementById("main");
    const mainRe = (
        <LeaderboardMain
            summaries={summaries}
            stadium={STADIUM}
        />
    );
    ReactDOM.unmountComponentAtNode(mainEl);
    ReactDOM.render(mainRe, mainEl);
}

renderMain(null);
const summaryRef = db.ref("summary").orderByChild("saved").startAt(fromTime);
summaryRef.on("value", (snap) => {
    const val = snap.val();
    const summaries = toList(val).filter((s) => {
        return s.stadium === STADIUM;
    }).sort((a, b) => {
        return a.saved - b.saved;
    });
    renderMain(summaries);
});
